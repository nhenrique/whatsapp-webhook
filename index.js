const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();
app.use(express.json());

// CONFIGURAÇÃO: Cole aqui o ID da sua planilha do Google Sheets
const SPREADSHEET_ID = '1uqP7rdf0T3Qm1GenbF6jZTRRLlM9pd2GMe0NbpiwBIk';

let sock;
let latestQr = null;
let myCreds = initAuthCreds();
let myKeys = {};

// Função limpa para buscar os dados salvos no Sheets
async function loadTokensFromSheets() {
    try {
        const response = await axios.get(`https://google.com{SPREADSHEET_ID}/gviz/tq?tqx=out:json`);
        const jsonText = response.data.match(/google\.visualization\.Query\.setResponse\(([\s\S\s]*)\);/);
        const data = JSON.parse(jsonText[1]);
        
        if (data.table.rows && data.table.rows.length > 0 && data.table.rows[0].c && data.table.rows[0].c[0]) {
            const rawValue = data.table.rows[0].c[0].v;
            if (rawValue && rawValue.startsWith('{')) {
                const decrypted = JSON.parse(rawValue, BufferJSON.reviver);
                if (decrypted.creds) myCreds = decrypted.creds;
                if (decrypted.keys) myKeys = decrypted.keys;
                console.log('Sessão carregada com sucesso da planilha.');
            }
        }
    } catch (e) {
        console.log('Iniciando com planilha vazia.');
    }
}

async function connectToWhatsApp() {
    await loadTokensFromSheets();

    sock = makeWASocket({ 
        auth: {
            creds: myCreds,
            keys: {
                get: (type, ids) => {
                    const res = {};
                    for (const id of ids) {
                        if (myKeys[`${type}-${id}`]) res[id] = myKeys[`${type}-${id}`];
                    }
                    return res;
                },
                set: (data) => {
                    for (const type in data) {
                        for (const id in data[type]) {
                            myKeys[`${type}-${id}`] = data[type][id];
                        }
                    }
                }
            }
        },
        browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', () => {
        const sessionText = JSON.stringify({ creds: sock.authState.creds, keys: myKeys }, BufferJSON.replacer);
        console.log('=========================================');
        console.log('TOKEN GERADO! COPIE O TEXTO ABAIXO E COLE NA LINHA 2 (A2) DA PLANILHA:');
        console.log(sessionText);
        console.log('=========================================');
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQr = qr;
            console.log('Novo QR Code disponível na rota /qr');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            latestQr = null;
            console.log('WhatsApp Conectado e autenticado!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (msg && !msg.key.fromMe && msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) {
            console.log(`=========================================`);
            console.log(`[GRUPO DETECTADO] ID do Grupo: ${msg.key.remoteJid}`);
            console.log(`=========================================`);
        }
    });
}

app.get('/qr', async (req, res) => {
    if (!latestQr) return res.send('<h1>WhatsApp conectado ou iniciando sessão. Aguarde 30 segundos e atualize.</h1>');
    try {
        const qrImageBase64 = await QRCode.toDataURL(latestQr);
        res.send(`<div style="text-align: center; margin-top: 50px;"><img src="${qrImageBase64}" style="width:300px;"/></div>`);
    } catch (err) { res.status(500).send('Erro'); }
});

app.post('/webhook', async (req, res) => {
    const { grupoId, mensagem } = req.body;
    try {
        await sock.sendMessage(grupoId, { text: mensagem });
        return res.json({ status: 'Sucesso' });
    } catch (error) { return res.status(500).json({ error: 'Falha ao enviar mensagem' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => connectToWhatsApp());
