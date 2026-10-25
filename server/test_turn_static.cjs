const crypto = require('crypto');

function getTurnCredentials(name, secret) {
    const unixTimeStamp = parseInt(Date.now() / 1000) + 24 * 3600; 
    const username = [unixTimeStamp, name].join(':');
    const hmac = crypto.createHmac('sha1', secret);
    hmac.setEncoding('base64');
    hmac.write(username);
    hmac.end();
    const password = hmac.read();
    return { username, password };
}

const creds = getTurnCredentials(
    process.env.TURN_USERNAME || 'testuser',
    process.env.TURN_SECRET || 'replace-with-local-turn-secret'
);
console.log(creds);
