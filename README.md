# EOS Yield+ history

> EOS Yield+ grab history and save it to the databaseg.

## config
```
config
|- default.json
|- prod.json
|- test.json
|- dev.json
```
configure mysql connection,ws endpoint,abi endpoint
```js
{
  "state_history_server": "ws://127.0.0.1:7777",
  "get_abi_url": "http://127.0.0.1:8888/v1/chain/get_raw_abi",
  "mysql": {
    "host": "",
    "user": "",
    "password": "",
    "database": "history_yield"
  }
}
```

### Deploy

```sh
npm install -g pm2
npm i
pm2 start prod.config.js
```
