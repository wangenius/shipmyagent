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
GET http://localhost:7001/tasks
```

## debug

By default the runtime logs every LLM request payload (messages + system) to help debugging.

- Disable: `SMA_LOG_LLM_MESSAGES=0 shipmyagent start`
- Or set `llm.logMessages=false` in `ship.json`
