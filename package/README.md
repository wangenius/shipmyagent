# shipmyagent

## download

```bash
npm i -g shipmyagent
```

## quick start

```bash
shipmyagent .
```

## access

```http
GET http://localhost:3000/health
GET http://localhost:3000/api/status

POST http://localhost:3000/api/execute
Content-Type: application/json

{"instructions":"Say hi"}
```

## debug

By default the runtime logs every LLM request payload (messages + system) to help debugging.

- Disable: `SMA_LOG_LLM_MESSAGES=0 shipmyagent start`
- Or set `llm.logMessages=false` in `ship.json`
