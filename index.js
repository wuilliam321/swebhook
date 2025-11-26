const app = require('./src/app');
const { PORT } = require('./src/config');
const { setupLogging } = require('./src/logger');

setupLogging();

app.listen(PORT, () => {
    console.log(`Server is listening on port: ${PORT}`);
});
