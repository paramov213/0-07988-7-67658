const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Конфигурация окружения
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'discord_nitro_ultra_secret_2026_key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/messenger_db';

// Настройка промежуточного ПО
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Схемы базы данных MongoDB
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    displayName: { type: String, default: '' },
    bio: { type: String, default: 'Привет! Я использую Nitro Messenger.' },
    avatar: { type: String, default: 'https://i.imgur.com/6VBx3io.png' },
    banner: { type: String, default: 'https://i.imgur.com/w9O963v.png' },
    glowColor: { type: String, default: 'rgba(88, 101, 242, 0.5)' },
    lastSeen: { type: Date, default: Date.now },
    isOnline: { type: Boolean, default: false }
});

const MessageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// Подключение к базе данных
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Успешное подключение к MongoDB'))
    .catch(err => console.error('Ошибка подключения к базе данных:', err));

// Middleware для авторизации
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// API: Проверка текущего пользователя (Автовход)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// API: Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
        
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Имя пользователя уже занято' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            username, 
            password: hashedPassword, 
            displayName: username 
        });
        await newUser.save();

        const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: newUser });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

// API: Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Неверный пароль' });

        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при входе' });
    }
});

// Socket.io: Логика реального времени
const activeConnections = new Map();

io.on('connection', (socket) => {
    socket.on('authenticate', async (token) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findById(decoded.id);
            if (user) {
                user.isOnline = true;
                await user.save();
                activeConnections.set(user._id.toString(), socket.id);
                socket.userId = user._id.toString();
                io.emit('userStatusUpdate', { userId: user._id, isOnline: true });
            }
        } catch (err) {
            console.log('Ошибка аутентификации сокета');
        }
    });

    socket.on('sendMessage', async (data) => {
        const { receiverId, text } = data;
        if (!socket.userId || !text) return;

        const newMessage = new Message({
            sender: socket.userId,
            receiver: receiverId,
            text: text
        });
        await newMessage.save();

        const receiverSocketId = activeConnections.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('newMessage', newMessage);
        }
        socket.emit('newMessage', newMessage);
    });

    socket.on('disconnect', async () => {
        if (socket.userId) {
            const user = await User.findById(socket.userId);
            if (user) {
                user.isOnline = false;
                user.lastSeen = new Date();
                await user.save();
                activeConnections.delete(socket.userId);
                io.emit('userStatusUpdate', { 
                    userId: user._id, 
                    isOnline: false, 
                    lastSeen: user.lastSeen 
                });
            }
        }
    });
});

// Пинг для предотвращения сна сервера (Render/Railway)
app.get('/ping', (req, res) => res.send('pong'));
setInterval(() => {
    http.get(`http://localhost:${PORT}/ping`);
}, 600000);

server.listen(PORT, () => {
    console.log(`Сервер мессенджера запущен на порту ${PORT}`);
});
