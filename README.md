# config
config
|- default.json
|- prod.json
|- test.json
|- dev.json

configure mysql connection 
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

# yield-history

Grab history and save it to the database

### Development

```bash
$ npm install -g pm2
$ npm i
$ node index.js
```

### Deploy

```bash
$ npm start
$ npm stop
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.
- Use `npm run autod` to auto detect dependencies upgrade, see [autod](https://www.npmjs.com/package/autod) for more detail.


[egg]: https://eggjs.org