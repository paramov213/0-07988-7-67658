const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 1e8 });
const fs = require('fs');

const DB_FILE = './users.json';
const MSG_FILE = './messages.json'; // Файл для хранения переписки

let db = { users: {} };
let history = []; // Массив для хранения всех сообщений

// Загрузка данных
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE));
if (fs.existsSync(MSG_FILE)) history = JSON.parse(fs.readFileSync(MSG_FILE));

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const saveHistory = () => fs.writeFileSync(MSG_FILE, JSON.stringify(history, null, 2));

app.use(express.static(__dirname));

const activeSockets = {}; 
const userStatus = {};    

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        const login = data.login.trim();
        if (data.type === 'register') {
            if (db.users[login]) return socket.emit('auth-error', 'Логин занят');
            db.users[login] = { password: data.password, displayName: login, bio: "Celestra User", avatar: "" };
            saveDB();
        } else {
            if (!db.users[login] || db.users[login].password !== data.password) return socket.emit('auth-error', 'Ошибка');
        }
        
        socket.userName = login;
        activeSockets[login] = socket.id;
        userStatus[login] = 'online';

        // При входе отправляем пользователю ЕГО историю и список активных чатов
        const userHistory = history.filter(m => m.from === login || m.to === login);
        socket.emit('auth-success', { user: login, profile: db.users[login], history: userHistory });
        io.emit('user-status-update', { user: login, status: 'online' });
    });

    socket.on('private-message', (data) => {
        const msg = {
            from: socket.userName,
            to: data.to,
            text: data.text,
            image: data.image,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };
        history.push(msg);
        saveHistory();

        if (activeSockets[data.to]) io.to(activeSockets[data.to]).emit('msg-receive', msg);
        socket.emit('msg-receive', msg);
    });

    socket.on('search-user', (searchName) => {
        const query = searchName.replace('@', '').toLowerCase().trim();
        const found = Object.keys(db.users).find(name => name.toLowerCase() === query);
        if (found) {
            socket.emit('search-result', { 
                exists: true, username: found, 
                displayName: db.users[found].displayName, avatar: db.users[found].avatar 
            });
        } else { socket.emit('search-result', { exists: false }); }
    });

    socket.on('get-status', (username) => {
        socket.emit('status-result', { user: username, status: userStatus[username] || 'был(а) недавно' });
    });

    socket.on('disconnect', () => {
        if (socket.userName) {
            userStatus[socket.userName] = `был(а) в ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
            io.emit('user-status-update', { user: socket.userName, status: userStatus[socket.userName] });
            delete activeSockets[socket.userName];
        }
    });
});

http.listen(3000, '0.0.0.0', () => console.log('Celestra: http://localhost:3000'));
