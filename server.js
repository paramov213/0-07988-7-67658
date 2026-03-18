/**
 * CELESTRA MESSENGER - FULL MONOLITHIC CORE
 * Содержит все модули: Экономика, Безопасность, Профили, Логи
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, // Поддержка тяжелых GIF и фото
    cors: { origin: "*" } 
});
const fs = require('fs').promises;
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ БАЗЫ ---
let db = {
    users: {},          // Логин: Пароль
    profiles: {},       // Данные профиля (nick, ava, bio, lastSeen)
    economy: {},        // Баланс, инвентарь, бонусы
    messages: {},       // Личные переписки (ID_ID: [сообщения])
    globalChat: [],     // Последние 100 сообщений мира
    system: {
        locked: false,
        admin: null
    }
};

// --- СИСТЕМА СОХРАНЕНИЯ ---
async function initDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        db = JSON.parse(data);
        console.log("✅ База данных Celestra загружена успешно.");
    } catch (e) {
        console.log("⚠️ База не найдена. Создаю новую структуру...");
        await saveDB();
    }
}

async function saveDB() {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 4));
    } catch (e) {
        console.error("❌ КРИТИЧЕСКАЯ ОШИБКА ЗАПИСИ БД:", e);
    }
}

initDB();

// --- КОНСТАНТЫ МАГАЗИНА ---
const MARKET = [
    { id: 1, name: "🌟 Золотой Ник", price: 500, type: "style", value: "gold" },
    { id: 2, name: "🌈 Радужный Ник", price: 1500, type: "style", value: "rainbow" },
    { id: 3, name: "💎 VIP Статус", price: 5000, type: "badge", value: "VIP" }
];

const sessions = {}; // socket.id -> username

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    
    // --- 1. АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ---
    socket.on('auth', async (data) => {
        const { login, password, type } = data;
        const user = login?.trim().toLowerCase();

        if (!user || !password) return socket.emit('err', 'Заполни все поля!');

        if (type === 'reg') {
            if (db.users[user]) return socket.emit('err', 'Логин уже занят!');
            db.users[user] = password;
            db.profiles[user] = {
                nick: login,
                ava: `https://api.dicebear.com/7.x/identicon/svg?seed=${user}`,
                bio: "Пользователь Celestra",
                ls: "Online"
            };
            db.economy[user] = { coins: 100, items: [], lastBonus: 0 };
            await saveDB();
        }

        if (db.system.locked && user !== db.system.admin) {
            return socket.emit('err', 'Доступ закрыт админом.');
        }

        if (db.users[user] !== password) return socket.emit('err', 'Неверный логин или пароль');

        socket.un = user;
        sessions[user] = socket.id;
        db.profiles[user].ls = "Online";
        
        socket.emit('auth_ok', { 
            un: user, 
            prof: db.profiles[user], 
            eco: db.economy[user] 
        });
        console.log(`👤 @${user} вошел в сеть.`);
    });

    // --- 2. ОБНОВЛЕНИЕ ПРОФИЛЯ (НИК, GIF, БИО) ---
    socket.on('update_prof', async (d) => {
        if (!socket.un) return;
        const p = db.profiles[socket.un];
        if (d.nick) p.nick = d.nick;
        if (d.ava) p.ava = d.ava; // Сюда можно слать ссылку на GIF
        if (d.bio) p.bio = d.bio;
        await saveDB();
        socket.emit('auth_ok', { un: socket.un, prof: p, eco: db.economy[socket.un] });
    });

    // --- 3. ОБРАБОТКА СООБЩЕНИЙ ---
    socket.on('msg', async (d) => {
        if (!socket.un || !d.to) return;

        const msg = {
            f: socket.un,
            t: d.to,
            txt: d.txt,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            p: db.profiles[socket.un],
            e: db.economy[socket.un]
        };

        // Глобальный чат
        if (d.to === 'global') {
            db.globalChat.push(msg);
            if (db.globalChat.length > 100) db.globalChat.shift();
            await saveDB();
            return io.emit('receive', { room: 'global', msg });
        }

        // Бот SHICT
        if (d.to === 'shict') return handleShict(socket, d.txt);

        // Бот SYSTEM (Админка)
        if (d.to === 'system') {
            if (d.txt === 'xeone5ttt') {
                db.system.admin = socket.un;
                await saveDB();
                return socket.emit('receive', { room: 'system', msg: { f: 'system', txt: 'Права администратора выданы.' } });
            }
            if (socket.un === db.system.admin && d.txt === 'выключи систему') {
                db.system.locked = true; await saveDB();
                io.emit('lockdown');
            }
            return;
        }

        // Личка + Майнинг
        db.economy[socket.un].coins += 5; // +5 коинов за сообщение
        const id = [socket.un, d.to].sort().join('_');
        if (!db.messages[id]) db.messages[id] = [];
        db.messages[id].push(msg);
        await saveDB();

        if (sessions[d.to]) io.to(sessions[d.to]).emit('receive', { room: socket.un, msg });
        socket.emit('receive', { room: d.to, msg });
    });

    // --- 4. БОТ МАГАЗИНА ---
    async function handleShict(s, txt) {
        const cmd = txt.toLowerCase();
        const eco = db.economy[s.un];
        let res = "Команды: баланс, бонус, магазин, купить [ID], казино [ставка]";

        if (cmd === 'баланс') res = `💰 Твой баланс: ${eco.coins}`;
        else if (cmd === 'бонус') {
            if (Date.now() - eco.lastBonus > 86400000) {
                eco.coins += 150; eco.lastBonus = Date.now(); await saveDB();
                res = "🎁 Бонус +150 коинов получен!";
            } else res = "⏳ Бонус можно брать раз в 24 часа.";
        }
        else if (cmd === 'магазин') res = "🛒 ТОВАРЫ:\n" + MARKET.map(i => `${i.id}. ${i.name} — ${i.price}`).join('\n');
        else if (cmd.startsWith('купить')) {
            const id = parseInt(cmd.split(' ')[1]);
            const item = MARKET.find(i => i.id === id);
            if (item && eco.coins >= item.price) {
                eco.coins -= item.price; eco.items.push(item); await saveDB();
                res = `✅ Куплено: ${item.name}!`;
            } else res = "❌ Не хватает монет или неверный ID.";
        }

        s.emit('receive', { room: 'shict', msg: { f: 'shict', txt: res, p: { nick: 'SHICT SHOP', ava: 'https://cdn-icons-png.flaticon.com/512/1198/1198290.png' } } });
    }

    // --- 5. ИСТОРИЯ И ПРОФИЛИ ---
    socket.on('get_h', (target) => {
        if (!socket.un) return;
        const id = [socket.un, target].sort().join('_');
        const prof = db.profiles[target] || { nick: target };
        
        // Статус в реальном времени
        if (sessions[target]) prof.ls = "Online";
        const coins = db.economy[target]?.coins || 0;

        socket.emit('h_res', { 
            target, 
            msgs: (target === 'global' ? db.globalChat : db.messages[id] || []),
            prof: { ...prof, coins }
        });
    });

    // Индикатор печати
    socket.on('typing', (to) => {
        if (sessions[to]) io.to(sessions[to]).emit('is_typing', { f: socket.un });
    });

    socket.on('disconnect', async () => {
        if (socket.un) {
            db.profiles[socket.un].ls = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            await saveDB();
            delete sessions[socket.un];
        }
    });
});

http.listen(3000, () => console.log('🚀 CELESTRA запущен на порту 3000'));
