const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 1e8 });
const fs = require('fs');

const DB_FILE = './users.json';
const MSG_FILE = './messages.json';

let db = { users: {} };
let history = [];

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
            db.users[login] = { password: data.password, displayName: login, bio: "Использую Celestra ✨", avatar: "" };
            saveDB();
        } else {
            if (!db.users[login] || db.users[login].password !== data.password) return socket.emit('auth-error', 'Ошибка входа');
        }
        socket.userName = login;
        activeSockets[login] = socket.id;
        userStatus[login] = 'online';
        
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
            ts: Date.now()
        };
        history.push(msg);
        saveHistory();
        if (activeSockets[data.to]) io.to(activeSockets[data.to]).emit('msg-receive', msg);
        socket.emit('msg-receive', msg);
    });

    socket.on('update-profile', (data) => {
        if (db.users[socket.userName]) {
            Object.assign(db.users[socket.userName], data);
            saveDB();
            socket.emit('profile-updated', db.users[socket.userName]);
        }
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

    socket.on('get-user-info', (username) => {
        const u = db.users[username];
        if (u) socket.emit('user-info-data', { 
            username, displayName: u.displayName, bio: u.bio, avatar: u.avatar, status: userStatus[username] || 'offline' 
        });
    });

    socket.on('get-status', (user) => socket.emit('status-result', { user, status: userStatus[user] || 'был(а) недавно' }));

    socket.on('disconnect', () => {
        if (socket.userName) {
            userStatus[socket.userName] = `в ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
            io.emit('user-status-update', { user: socket.userName, status: userStatus[socket.userName] });
            delete activeSockets[socket.userName];
        }
    });
});

http.listen(3000, '0.0.0.0', () => console.log('Celestra: http://localhost:3000'));
