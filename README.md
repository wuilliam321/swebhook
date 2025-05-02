# swebhook
Cambiar la api key


run
ngrok http --url=beetle-prompt-enormously.ngrok-free.app 8000
node --env-file=.env webhook.js

`.env`:
```
WEBHOOK_VERIFY_TOKEN=
GRAPH_API_TOKEN=
PHONE_ID=
PORT=8000
DEBUG=false
GENERATOR_URL=http://192.168.1.26:8001
```
