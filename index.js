const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        // printQRInTerminal foi removido para evitar o aviso
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Se a biblioteca gerar um QR Code, nós pegamos ele aqui e desenhamos na tela
        if (qr) {
            console.log('=========================================');
            console.log('ESCANEIE O QR CODE ABAIXO NO SEU CELULAR:');
            console.log('=========================================');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('=========================================');
            console.log('Sua API está ONLINE e conectada ao WhatsApp!');
            console.log('=========================================');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages;
        if (msg && msg[0] && !msg[0].key.fromMe && msg[0].key.remoteJid && msg[0].key.remoteJid.endsWith('@g.us')) {
            console.log(`[GRUPO DETECTADO] ID do Grupo: ${msg[0].key.remoteJid}`);
        }
    });
}

app.post('/webhook', async (req, res) => {
    const { grupoId, mensagem } = req.body;

    if (!grupoId || !mensagem) {
        return res.status(400).json({ error: 'Faltam os campos grupoId ou mensagem no JSON' });
    }

    try {
        await sock.sendMessage(grupoId, { text: mensagem });
        return res.json({ status: 'Sucesso', mensagem: 'Enviada com sucesso para o grupo!' });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        return res.status(500).json({ error: 'Falha ao enviar a mensagem' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    connectToWhatsApp();
});
