const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();
app.use(express.json());

// CONFIGURAÇÃO: Cole aqui o ID da sua planilha do Google Sheets
const SPREADSHEET_ID = 'COLE_AQUI_O_ID_DA_SUA_PLANILHA';

let sock;
let latestQr = null;
let savedCreds = {};

// Função inteligente que lê e grava os dados usando uma API pública do Google (sem precisar de contas complexas)
async function useSheetsAuthState() {
    try {
        const response = await axios.get(`https://google.com{SPREADSHEET_ID}/gviz/tq?tqx=out:json`);
        const jsonText = response.data.match(/google\.visualization\.Query\.setResponse\(([\s\S\s]*)\);/)[1];
        const data = JSON.parse(jsonText);
        if (data.table.rows.length > 0 && data.table.rows[0].c[0]) {
            savedCreds = JSON.parse(data.table.rows[0].c[0].v);
        }
    } catch (e) {
        console.log('Iniciando sem credenciais salvas.');
    }

    return {
        state: {
            creds: savedCreds.creds || {},
            keys: {
                get: async (type, ids) => {
                    const res = {};
                    for (const id of ids) { if (savedCreds[`${type}-${id}`]) res[id] = savedCreds[`${type}-${id}`]; }
                    return res;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) { savedCreds[`${type}-${id}`] = data[type][id]; }
                    }
                }
            }
        },
        saveCreds: async () => {
            savedCreds.creds = sock.authState.creds;
            console.log('=========================================');
            console.log('TOKEN GERADO! COPIE O TEXTO ABAIXO E COLE NA LINHA 2 DA SUA PLANILHA:');
            console.log(JSON.stringify(savedCreds));
            console.log('=========================================');
        }
    };
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useSheetsAuthState();
    sock = makeWASocket({ auth: state });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) latestQr = qr;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            latestQr = null;
            console.log('WhatsApp Conectado e autenticado via Sheets!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages;
        if (msg && !msg.key.fromMe && msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) {
            console.log(`[GRUPO DETECTADO] ID do Grupo: ${msg.key.remoteJid}`);
        }
    });
}

app.get('/qr', async (req, res) => {
    if (!latestQr) return res.send('<h1>WhatsApp conectado ou lendo token. Se acabou de ligar, aguarde 30s.</h1>');
    try {
        const qrImageBase64 = await QRCode.toDataURL(latestQr);
        res.send(`<div style="text-align: center; margin-top: 50px;"><img src="${qrImageBase64}" style="width:300px;"/></div>`);
    } catch (err) { res.status(500).send('Erro'); }
});

app.post('/webhook', async (req, res) => {
    const { grupoId, mensagem } = req.body;
    try {
        await sock.sendMessage(grupoId, { text: mensaje });
        return res.json({ status: 'Sucesso' });
    } catch (error) { return res.status(500).json({ error: 'Falha' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => connectToWhatsApp());
