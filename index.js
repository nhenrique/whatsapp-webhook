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
        printQRInTerminal: true // Isso vai desenhar o QR Code na tela de Logs do Render
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
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

    // Esse bloco escuta as mensagens e mostra o ID do grupo nos logs quando você manda algo lá
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.key.remoteJid.endsWith('@g.us')) {
            console.log(`[GRUPO DETECTADO] Nome/ID: ${msg.key.remoteJid}`);
        }
    });
}

// Rota do seu Webhook (Onde os sistemas vão bater)
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

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    connectToWhatsApp();
});
