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

// Конфигурационные константы
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'discord_nitro_ultra_secret_2026_key';
// ВНИМАНИЕ: Для локальной разработки используйте localhost, для деплоя — строку MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/messenger_db';

// Настройка Middleware
app.use(cors());
app.use(express.json());
// Указываем Express отдавать статику прямо из корня проекта
app.use(express.static(__dirname));

// Схемы данных MongoDB
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
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});

const StreakSchema = new mongoose.Schema({
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    count: { type: Number, default: 1 },
    lastInteraction: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Streak = mongoose.model('Streak', StreakSchema);

// Подключение к базе данных
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Успешное подключение к MongoDB'))
    .catch(err => console.error('Ошибка подключения к БД:', err));

// API Маршруты
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Это имя пользователя уже занято' });
        }

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
        res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Неверный пароль' });
        }

        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
});

app.get('/api/users/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);
        const users = await User.find({ username: new RegExp(q, 'i') }).limit(10);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка поиска' });
    }
});

// Socket.io Логика в реальном времени
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
                console.log(`Пользователь ${user.username} подключился`);
            }
        } catch (err) {
            console.log('Ошибка аутентификации сокета');
        }
    });

    socket.on('sendMessage', async (data) => {
        const { receiverId, text } = data;
        if (!socket.userId) return;

        const newMessage = new Message({
            sender: socket.userId,
            receiver: receiverId,
            text: text
        });
        await newMessage.save();

        // Логика Огней (Streaks)
        let streak = await Streak.findOne({
            users: { $all: [socket.userId, receiverId] }
        });

        if (!streak) {
            streak = new Streak({ users: [socket.userId, receiverId], count: 1 });
            await streak.save();
        } else {
            const now = new Date();
            const timeDiff = (now - streak.lastInteraction) / (1000 * 60 * 60);
            if (timeDiff >= 24 && timeDiff < 48) {
                streak.count += 1;
            } else if (timeDiff >= 48) {
                streak.count = 1;
            }
            streak.lastInteraction = now;
            await streak.save();
        }

        const receiverSocketId = activeConnections.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('newMessage', newMessage);
            io.to(receiverSocketId).emit('updateStreak', { streak, partnerId: socket.userId });
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

// Пинг-система для предотвращения сна сервера
app.get('/ping', (req, res) => res.send('Система активна'));
setInterval(() => {
    http.get(`http://localhost:${PORT}/ping`, (res) => {
        console.log('Самопроверка активности выполнена');
    });
}, 600000); // 10 минут

// Роутинг для SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Глобальная обработка ошибок для предотвращения падения (Status 1)
process.on('uncaughtException', (err) => {
    console.error('КРИТИЧЕСКАЯ ОШИБКА:', err);
});

server.listen(PORT, () => {
    console.log(`Сервер мессенджера запущен на порту: ${PORT}`);
});
