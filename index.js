const WebSocket = require('ws');
const {
  Serialize
} = require('eosjs');
const {
  TextDecoder,
  TextEncoder
} = require('text-encoding');
const zlib = require('zlib');
const mysql = require('promise-mysql');
const config = require('config');
const axios = require('axios');


const abiTypes = Serialize.getTypesFromAbi(Serialize.createAbiTypes());
const abiDefTypes = abiTypes.get('abi_def');

const txEnc = new TextEncoder();
const txDec = new TextDecoder();

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

class HistoryTrace {
  constructor() {
    this.irreversibleOnly = false;

    this.abi = null;
    this.types = null;
    this.blocksQueue = [];
    this.inProcessBlocks = false;

    const socketAddress = config.get('state_history_server');
    this.ws = new WebSocket(socketAddress, {
      perMessageDeflate: false
    });
    this.ws.on('message', data => this.onMessage(data));
    this.numRows = 0;

    this.abiCaches = {};

    const filterOn = config.get('filter-on');
    const filterOut = config.get('filter-out');
    this.filters = {
      on: [],
      out: []
    };
    this.parseAbis = config.get('parse-abis');
    for (const filter of filterOn) {
      if (filter.indexOf(':') > 0) {
        this.filters.on.push(filter.split(':'));
      }
    }
    for (const filter of filterOut) {
      if (filter.indexOf(':') > 0) {
        this.filters.out.push(filter.split(':'));
      }
    }
  }

  filter(account, action) {
    if (this.filters.on.some(f => (f[0] == '*' || f[0] == account) && (f[1] == '*' || f[1] == action))) {
      return !this.filters.out.some(f => (f[0] == '*' || f[0] == account) && (f[1] == '*' || f[1] == action));
    }
    return false;
  }

  serialize(type, value) {
    const buffer = new Serialize.SerialBuffer({
      textEncoder: txEnc,
      textDecoder: txDec
    });
    Serialize.getType(this.types, type).serialize(buffer, value);
    return buffer.asUint8Array();
  }

  deserialize(type, array) {
    const buffer = this.createSerialBuffer(array);
    let result = Serialize.getType(this.types, type).deserialize(buffer, new Serialize.SerializerState({
      bytesAsUint8Array: true
    }));
    if (buffer.readPos != array.length)
      throw new Error('oops: ' + type); // todo: remove check
    return result;
  }

  createSerialBuffer(inputArray) {
    return new Serialize.SerialBuffer({
      textEncoder: txEnc,
      textDecoder: txDec,
      array: inputArray
    });
  }

  toJsonUnpackTransaction(x) {
    return JSON.stringify(x, (k, v) => {
      if (k === 'trx' && Array.isArray(v) && v[0] === 'packed_transaction') {
        const pt = v[1];
        let packed_trx = pt.packed_trx;
        if (pt.compression === 0)
          packed_trx = this.deserialize('transaction', packed_trx);
        else if (pt.compression === 1)
          packed_trx = this.deserialize('transaction', zlib.unzipSync(packed_trx));
        return {
          ...pt,
          packed_trx
        };
      }
      if (k === 'packed_trx' && v instanceof Uint8Array)
        return this.deserialize('transaction', v);
      if (v instanceof Uint8Array)
        return `(${v.length} bytes)`;
      return v;
    }, 4)
  }

  send(request) {
    this.ws.send(this.serialize('request', request));
  }

  onMessage(data) {
    try {
      if (!this.abi) {
        this.abi = JSON.parse(data);
        this.types = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), this.abi);

        this.start();
      } else {
        const [type, response] = this.deserialize('result', data);
        this[type](response);
      }
    } catch (e) {
      console.log(e);
      process.exit(1);
    }
  }

  requestStatus() {
    this.send(['get_status_request_v0', {}]);
  }

  requestBlocks(requestArgs) {
    this.send(['get_blocks_request_v0', {
      start_block_num: 0,
      end_block_num: 0xffffffff,
      max_messages_in_flight: 5,
      have_positions: [],
      irreversible_only: false,
      fetch_block: false,
      fetch_traces: false,
      fetch_deltas: false,
      ...requestArgs
    }]);
  }

  get_status_result_v0(response) {
    console.log(response);
  }

  get_blocks_result_v1(response) {
    this.blocksQueue.push(response);
    this.processBlocks();
  }

  async processBlocks() {
    if (this.inProcessBlocks)
      return;
    this.inProcessBlocks = true;
    while (this.blocksQueue.length) {
      let response = this.blocksQueue.shift();
      this.send(['get_blocks_ack_request_v0', {
        num_messages: 1
      }]);
      let block, traces = [],
        deltas = [];
      if (response.block && response.block.length) {
        block = response.block[1];
      }
      if (response.traces && response.traces.length) {
        traces = this.deserialize('transaction_trace[]', response.traces);
      }
      if (response.deltas && response.deltas.length) {
        deltas = this.deserialize('table_delta[]', zlib.unzipSync(response.deltas));
      }
      await this.receivedBlock(response, block, traces, deltas);
    }
    this.inProcessBlocks = false;
  }

  async processTraces(block_num, timestamp, producer, traces) {
    const t2 = Date.now();
    const actions = [];
    //todo action count erro
    this.action_count = 0;
    for (const trace of traces) {
      const transaction_trace = trace[1];
      if (transaction_trace.status !== 0) {
        continue;
      }
      const trx_id = transaction_trace['id'].toLowerCase();
      const action_traces = transaction_trace['action_traces'];
      const t3 = Date.now();
      for (const action_trace of action_traces) {
        if (action_trace[0] === 'action_trace_v1') {
          const action = action_trace[1];
          const status = await this.processAction(actions, timestamp, action, trx_id, block_num, producer, null, 0);
        }
      }

      const act_elapsed_time = Date.now() - t3;
      if (act_elapsed_time > 100) {
        console.log(`[WARNING] Actions processing took ${act_elapsed_time}ms on trx ${trx_id}`);
        // console.log(action_traces);
      }
    }
    console.log(`#${block_num} process ${this.action_count} actions`);
    const traces_elapsed_time = Date.now() - t2;
    if (traces_elapsed_time > 10) {
      console.log(`[WARNING] Traces processing took ${traces_elapsed_time}ms on block ${block_num}`);
    }
    return actions;
  }

  async processAction(actions, ts, action, trx_id, block_num, prod, parent, parent_act_data) {
    const accountCode = action['act']['account'];
    const actionName = action['act']['name'];
    let isParse = true;
    if (accountCode == 'eosio' && actionName === 'setabi') {
      isParse = true;
    } else if (accountCode == 'eosio' && actionName === 'onblock') {
      isParse = false;
    } else if (typeof this.filter == 'function' && !this.filter(accountCode, actionName)) {
      isParse = false;
    }

    if (!action['receipt'] || action['receipt'][1]['receiver'] !== accountCode) {
      //onerror
      return false;
    }
    const receipt = action['receipt'][1];
    let g_seq = parent !== null ? parent : receipt['global_sequence'];
    let actDataString = '';
    let notifiedAccounts = new Set();
    notifiedAccounts.add(receipt['receiver']);
    if (isParse) {
      this.action_count++;
      const newAction = {};
      newAction['@timestamp'] = ts;
      newAction['global_sequence'] = parseInt(receipt['global_sequence'], 10);

      if (parent !== null) {
        newAction['parent'] = g_seq;
      } else {
        newAction['parent'] = 0;
      }
      newAction['block_num'] = block_num;
      newAction['trx_id'] = trx_id;
      newAction['producer'] = prod;

      let act = action['act'];
      const original_act = Object.assign({}, act);
      act.data = new Uint8Array(Object.values(act.data));
      const src_acts = [act];
      let ds_act;
      ds_act = await this.deserializeActionsAtBlock(src_acts, block_num);
      newAction['act'] = ds_act[0];
      this.attachActionExtras(action);

      if (action['account_ram_deltas'].length > 0) {
        newAction['account_ram_deltas'] = action['account_ram_deltas'];
      }

      actDataString = JSON.stringify(action['act']['data']);

      if (parent_act_data !== actDataString) {
        newAction['notified'] = Array.from(notifiedAccounts);
        actions.push(newAction);
      }
    }

    if (action['inline_traces'] && action['inline_traces'].length > 0) {
      g_seq = receipt['global_sequence'];
      for (const inline_trace of action['inline_traces']) {
        const notified = await this.processAction(actions, ts, inline_trace[1], trx_id, block_num, prod, g_seq, actDataString);
        // Merge notifications with the parent action
        if (notified && notified.length) {
          for (const acct of notified) {
            notifiedAccounts.add(acct);
          }
        }
      }
    }

    return parent !== null ? notifiedAccounts : isParse;
  }

  attachActionExtras(action) {
    // Transfer actions
    if (action['act']['name'] === 'transfer') {

      let qtd = null;
      if (action['act']['data']['quantity']) {
        qtd = action['act']['data']['quantity'].split(' ');
        delete action['act']['data']['quantity'];
      } else if (action['act']['data']['value']) {
        qtd = action['act']['data']['value'].split(' ');
        delete action['act']['data']['value'];
      }

      if (qtd) {
        action['@transfer'] = {
          from: String(action['act']['data']['from']),
          to: String(action['act']['data']['to']),
          amount: parseFloat(qtd[0]),
          symbol: qtd[1]
        };
        delete action['act']['data']['from'];
        delete action['act']['data']['to'];

        action['@transfer']['memo'] = action['act']['data']['memo'];
        delete action['act']['data']['memo'];

      }

    } else if (action['act']['name'] === 'newaccount' && action['act']['account'] === 'eosio') {

      let name = null;
      if (action['act']['data']['newact']) {
        name = action['act']['data']['newact'];
      } else if (action['act']['data']['name']) {
        name = action['act']['data']['name'];
        delete action['act']['data']['name'];
      }
      if (name) {
        action['@newaccount'] = {
          active: action['act']['data']['active'],
          owner: action['act']['data']['owner'],
          newact: name
        }
      }
      // await handleNewAccount(action['act']['data'], action, ts);
    } else if (action['act']['name'] === 'updateauth' && action['act']['account'] === 'eosio') {
      // await handleUpdateAuth(action['act']['data'], action, ts);
      const _auth = action['act']['data']['auth'];
      if (_auth['accounts'].length === 0) delete _auth['accounts'];
      if (_auth['keys'].length === 0) delete _auth['keys'];
      if (_auth['waits'].length === 0) delete _auth['waits'];
      action['@updateauth'] = {
        permission: action['act']['data']['permission'],
        parent: action['act']['data']['parent'],
        auth: _auth
      };
    }
  }

  async deserializeActionsAtBlock(actions, block_num) {
    return await Promise.all(actions.map(async ({
      account,
      name,
      authorization,
      data
    }) => {
      const contract = await this.getContractAtBlock(account, block_num);
      return Serialize.deserializeAction(
        contract, account, name, authorization, data, txEnc, txDec);
    }));
  }




  async getMysqlConnection() {
    return mysql.createConnection(config.get('mysql'));
  }

  async start() {
    try {
      const conn = await this.getMysqlConnection();
      let statusRow = await conn.query(`select * from dex_status`);
      const status = statusRow && statusRow.length ? statusRow[0] : {
        head: 0,
        irreversible: 0
      };
      this.head = status.head;
      this.irreversible = status.irreversible;

      let have_positions = (await conn.query(`select * from dex_blocks where block_num >= ${this.irreversible + 1} and block_num <= ${this.head}`))
        .map(({
          block_num,
          block_id
        }) => ({
          block_num,
          block_id
        }));
      conn.end();
      //console.log(have_positions);

      this.requestBlocks({
        irreversible_only: this.irreversibleOnly,
        start_block_num: this.head + 1,
        have_positions,
        fetch_block: true,
        fetch_traces: true,
        fetch_deltas: false,
      });
    } catch (e) {
      console.log(e);
      process.exit(1);
    }
  }

  async receivedBlock(response, block, traces, deltas) {
    if (!response.this_block) {
      return;
    }
    let block_num = response.this_block.block_num;
    if (!(block_num % 100) || block_num >= this.irreversible) {
      if (this.numRows) {
        console.log(`    created ${numberWithCommas(this.numRows)} rows`);
      }
      this.numRows = 0;
      console.log(`block ${numberWithCommas(block_num)}`)
    }
    try {
      if (this.head && block_num > this.head + 1)
        throw new Error(`Skipped block(s): head = ${this.head}, received = ${block_num}`);
      if (!block) {
        const time = new Date();
        let fullTime = time.getUTCFullYear() + '-' + (time.getUTCMonth() + 1) + '-' + time.getUTCDate() + ' ' + time.getUTCHours() + ':' + time.getUTCMinutes() + ':' + time.getUTCSeconds();
        fullTime = fullTime.replace(/([\ \-\:])(\d*)/g, (match, p1, p2) => p1 + (parseInt(p2) < 10 ? '0' : '') + p2);
        block = {
          timestamp: fullTime,
          producer: "unkonwn"
        };
      }
      let switchForks = this.head && block_num < this.head + 1;

      const conn = await this.getMysqlConnection();

      await conn.query('start transaction;');
      this.head = block_num;
      this.irreversible = response.last_irreversible.block_num;
      await conn.query('update dex_status set head=?, irreversible=?', [this.head, this.irreversible]);

      if (switchForks) {
        //Dealing with the actions
        const act_ids = [];
        const rows = await conn.query('select id from dex_actions where block_num >= ? order by id desc', [block_num]);
        for (const r of rows) {
          act_ids.push(r.id);
        }
        //Y processing
        await conn.query('delete from dex_blocks where block_num >= ?', [block_num]);
        if (act_ids.length > 0) {
          await conn.query(`insert into dex_events(type, act_ids, block_num, timestamp) values (?, ?, ?, ?)`, [2, act_ids.join(','), block_num, block.timestamp]);
        }
      }
      // delete dex_blocks
      await conn.query('delete from dex_blocks where block_num < ?', [this.irreversible - 200]);

      //Insert block data
      await conn.query(`insert into dex_blocks(block_num,block_id) values (?, ?)`, [block_num, response.this_block.block_id]);

      //Plug-in trace data
      if (traces && traces.length > 0) {
        const act_ids = [];
        const actions = await this.processTraces(block_num, block.timestamp, block.producer, traces);
        for (const a of actions) {
          const act = a.act;
          if (act.account == 'eosio' && act.name == 'setabi') {
            if (this.parseAbis.indexOf(act.data.account) >= 0) {
              await this.updateContractAtBlock(act.data.account, act.data.abi, a.block_num);
            }
            continue;
          }
          if (act.account == 'eosio' && act.name == 'setcode' && act.data.code && act.data.code.length > 10) {
            act.data.code = '...';
          }
          //console.log(a);
          const fields = 'global_sequence,timestamp,parent,block_num,trx_id,producer,account,name,authorization,data,account_ram_deltas,notified';
          let result = await conn.query(`insert into dex_actions(${fields}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [a.global_sequence, a['@timestamp'], a.parent, a.block_num, a.trx_id, a.producer, act.account, act.name,
            JSON.stringify(act.authorization), JSON.stringify(act.data), JSON.stringify(a.account_ram_deltas), JSON.stringify(a.notified)
            ]);
          act_ids.push(result.insertId);
          a.id = result.insertId;
        }
        if (act_ids.length > 0) {
          await conn.query(`insert into dex_events(type, act_ids, block_num, timestamp) values (?, ?, ?, ?)`, [1, act_ids.join(','), block_num, block.timestamp]);
        }
      }

      await conn.query('commit;');
      conn.end();
    } catch (e) {
      console.log(e);
      process.exit(1);
    }
  } // receivedBlock

  async updateContractAtBlock(account, abiHex, block_num) {
    console.log('update contract account:' + account);
    let abiJson = '';
    if (abiHex != '' && abiHex != null) {
      const buffer = new Serialize.SerialBuffer({
        textEncoder: txEnc,
        textDecoder: txDec,
        array: Serialize.hexToUint8Array(abiHex)
      });
      const abi = abiDefTypes.deserialize(buffer);
      this.abiCaches[account] = abi;
      abiJson = JSON.stringify(abi);
    } else {
      delete this.abiCaches[account];
    }
    //console.log(account);
    //console.log(abiJson);
    const conn = await this.getMysqlConnection();
    conn.query('replace into dex_abis(account,abi,block_num,update_time) values(?, ?, ?, ?)', [account, abiJson, block_num, new Date()]);
    conn.end();

  }

  async getContractAtBlock(account, block_num) {
    //console.log('getContractAtBlock', account, block_num);
    if (this.abiCaches[account]) {
      return this.abiCaches[account];
    }

    const conn = await this.getMysqlConnection();
    const abiRows = await conn.query(`select abi from dex_abis where account='${account}' limit 1`);
    let abi = null;
    if (abiRows && abiRows.length) {
      try {
        abi = JSON.parse(abiRows[0].abi);
      } catch (e) {
        console.log(e);
        throw new Error(`parse ${account}'s abi error: ${e.message}`);
      }
      console.log(`got ${account}'s abi from db.`);
    } else {
      console.log(`${account}'s abi not found. then fetch from rpc.`);
      try {
        const response = await axios.post(config.get('get_abi_url'), `{ "account_name": "${account}" }`, {
          timeout: 3000
        });
        const rawAbi = Buffer.from(response.data.abi, 'base64');
        const buffer = new Serialize.SerialBuffer({
          textEncoder: txEnc,
          textDecoder: txDec,
          array: rawAbi
        });
        abi = abiDefTypes.deserialize(buffer);
        //console.log(abi);
        conn.query('replace into dex_abis(account,abi,block_num,update_time) values(?, ?, ?, ?)', [account, JSON.stringify(abi), block_num, new Date()]);
      } catch (e) {
        console.log(e);
        throw new Error(`get ${account}'s abi error: ${e.message}`);
      }
      console.log(`got ${account}'s abi from rpc.`);
    }
    conn.end();

    const initialTypes = Serialize.createInitialTypes();
    let types = Serialize.getTypesFromAbi(initialTypes, abi);
    const actions = new Map();
    for (const { name, type } of abi.actions) {
      actions.set(name, Serialize.getType(types, type));
    }
    this.abiCaches[account] = { types, actions };
    return this.abiCaches[account];

  }
}
new HistoryTrace();
