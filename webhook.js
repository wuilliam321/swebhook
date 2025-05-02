const express = require("express");
const axios = require('axios');

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PHONE_ID, PORT, DEBUG } = process.env;


const sendMessage = async (to, text) => {
  const req = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  }
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,
      req,
      {
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status != 200) {
      return {
        success: false,
        message: response.statusText,
      }
    }
    return {
      success: true,
      message: text,
    }
  } catch (error) {
    console.error(
      "Error sending message:",
      error.response ? error.response.data : error.message
    );
    return {
      success: false,
      message: error.response ? error.response.data : error.message,
    }
  }
};

async function generateRequest(body) {
  try {
    const response = await axios.post('http://localhost:8001/generate',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'accept': 'application/json',
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error:', error);
  }
}


app.post("/webhook", async (req, res) => {
  const entry = req.body.entry[0];
  const changes = entry.changes[0];
  const value = changes.value;
  const message = value.messages && value.messages[0];

  if (message) {
    const res = await generateRequest({
      username: req.body.entry[0].id,
      message: "prueba",
      // message: message.text.value
    });
    await sendMessage(message.from, res.signedUrl)
    console.log("message sent", res.signedUrl)
  }
  res.sendStatus(200);
});

// accepts GET requests at the /webhook endpoint. You need this URL to setup webhook initially.
// info on verification request payload: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // check the mode and token sent are correct
  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    // respond with 200 OK and challenge token from the request
    res.status(200).send(challenge);
    console.log("Webhook verified successfully!");
  } else {
    // respond with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

app.get("/", (req, res) => {
  res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});
