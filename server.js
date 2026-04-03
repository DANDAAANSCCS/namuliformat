require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const bcrypt = require('bcrypt');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Init DB ────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS client_links (
        id SERIAL PRIMARY KEY,
        link_token VARCHAR(100) UNIQUE NOT NULL,
        client_name VARCHAR(100),
        created_by INTEGER REFERENCES employees(id),
        is_used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        link_id INTEGER REFERENCES client_links(id),
        roblox_id VARCHAR(50) NOT NULL,
        roblox_username VARCHAR(100),
        roblox_avatar_url TEXT,
        game_username VARCHAR(100) NOT NULL,
        game_password VARCHAR(255) NOT NULL,
        current_level INTEGER NOT NULL,
        target_level INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pendiente',
        admin_notes TEXT,
        user_phone VARCHAR(20),
        employee_id INTEGER REFERENCES employees(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS admin_config (
        id SERIAL PRIMARY KEY,
        admin_password_hash VARCHAR(255) NOT NULL,
        whatsapp_phone VARCHAR(20),
        whatsapp_apikey VARCHAR(255),
        employee_whatsapp_apikey VARCHAR(255),
        email_to VARCHAR(255),
        email_from VARCHAR(255),
        email_app_password VARCHAR(255)
      );
      CREATE TABLE IF NOT EXISTS code_requests (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id),
        code_token VARCHAR(100) UNIQUE NOT NULL,
        code_value VARCHAR(20),
        message TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        responded_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS quick_chat (
        id SERIAL PRIMARY KEY,
        sender_type VARCHAR(20) NOT NULL,
        sender_name VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Add columns if they don't exist (for existing DBs)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS email_to VARCHAR(255);
        ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS email_from VARCHAR(255);
        ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS email_app_password VARCHAR(255);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_phone VARCHAR(20);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token VARCHAR(255);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS install_url TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS subscription_months INTEGER DEFAULT 1;
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);

    const adminExists = await client.query('SELECT id FROM admin_config LIMIT 1');
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
      await client.query(
        'INSERT INTO admin_config (admin_password_hash, whatsapp_phone, email_to) VALUES ($1, $2, $3)',
        [hash, process.env.ADMIN_WHATSAPP || '+528121968034', '8randon3li@gmail.com']
      );
    }

    const empExists = await client.query('SELECT id FROM employees LIMIT 1');
    if (empExists.rows.length === 0) {
      const hash = await bcrypt.hash(process.env.EMPLOYEE_PASSWORD || 'empleado123', 10);
      await client.query(
        'INSERT INTO employees (username, password_hash, phone) VALUES ($1, $2, $3)',
        ['empleado1', hash, process.env.EMPLOYEE_WHATSAPP || '']
      );
    }

    console.log('✅ Base de datos inicializada');
  } finally {
    client.release();
  }
}

// ── WhatsApp (TextMeBot) ───────────────────────────────────
async function sendWhatsApp(phone, message, apikey) {
  if (!phone || !apikey) {
    console.log('⚠️ WhatsApp no configurado.');
    return false;
  }
  try {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const url = `http://api.textmebot.com/send.php?recipient=${encodeURIComponent(cleanPhone)}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(message)}`;
    const res = await axios.get(url, { timeout: 15000 });
    console.log('✅ WhatsApp enviado a', cleanPhone);
    return true;
  } catch (err) {
    console.error('❌ Error WhatsApp:', err.message);
    return false;
  }
}

// Send WhatsApp to anyone (using admin's apikey)
async function sendWhatsAppTo(phone, message) {
  const config = await pool.query('SELECT whatsapp_apikey FROM admin_config LIMIT 1');
  if (config.rows.length > 0 && config.rows[0].whatsapp_apikey) {
    return await sendWhatsApp(phone, message, config.rows[0].whatsapp_apikey);
  }
  return false;
}

// ── Email ──────────────────────────────────────────────────
async function sendEmail(to, subject, htmlBody) {
  const config = await pool.query('SELECT * FROM admin_config LIMIT 1');
  if (config.rows.length === 0) return false;
  const { email_from, email_app_password } = config.rows[0];
  if (!email_from || !email_app_password) return false;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: email_from, pass: email_app_password }
    });
    await transporter.sendMail({
      from: `"NamuLiFormat" <${email_from}>`,
      to, subject, html: htmlBody
    });
    console.log('✅ Email enviado a', to);
    return true;
  } catch (err) {
    console.error('❌ Error email:', err.message);
    return false;
  }
}

async function notifyAdmin(whatsappMsg, emailSubject, emailHtml) {
  const config = await pool.query('SELECT * FROM admin_config LIMIT 1');
  if (config.rows.length > 0) {
    const c = config.rows[0];
    await sendWhatsApp(c.whatsapp_phone, whatsappMsg, c.whatsapp_apikey);
    if (c.email_to) {
      await sendEmail(c.email_to, emailSubject || 'NamuLiFormat', emailHtml || whatsappMsg.replace(/\n/g, '<br>'));
    }
  }
}

async function notifyEmployee(employeeId, message) {
  const emp = await pool.query('SELECT phone FROM employees WHERE id = $1', [employeeId]);
  const config = await pool.query('SELECT whatsapp_apikey FROM admin_config LIMIT 1');
  if (emp.rows.length > 0 && emp.rows[0].phone && config.rows.length > 0 && config.rows[0].whatsapp_apikey) {
    await sendWhatsApp(emp.rows[0].phone, message, config.rows[0].whatsapp_apikey);
  }
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    const config = await pool.query('SELECT * FROM admin_config LIMIT 1');
    if (config.rows.length === 0) return res.status(401).json({ error: 'No configurado' });
    const valid = await bcrypt.compare(password, config.rows[0].admin_password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ success: true, token: 'admin-' + Date.now() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employee/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const emp = await pool.query('SELECT * FROM employees WHERE username = $1', [username]);
    if (emp.rows.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });
    const valid = await bcrypt.compare(password, emp.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ success: true, id: emp.rows[0].id, username: emp.rows[0].username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  EMPLOYEE
// ══════════════════════════════════════════════════════════════
app.post('/api/links/generate', async (req, res) => {
  try {
    const { client_name, employee_id } = req.body;
    const token = uuidv4().split('-')[0] + uuidv4().split('-')[1];
    const result = await pool.query(
      'INSERT INTO client_links (link_token, client_name, created_by) VALUES ($1, $2, $3) RETURNING *',
      [token, client_name || 'Usuario', employee_id]
    );
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    res.json({ success: true, link: `${baseUrl}/form.html?token=${token}`, token, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/links/employee/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM client_links WHERE created_by = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders/employee/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, cl.client_name, cl.link_token FROM orders o 
      JOIN client_links cl ON o.link_id = cl.id WHERE o.employee_id = $1 ORDER BY o.created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  CLIENT FORM
// ══════════════════════════════════════════════════════════════
app.get('/api/link/validate/:token', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM client_links WHERE link_token = $1', [req.params.token]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Link no válido' });
    if (result.rows[0].is_used) return res.status(410).json({ error: 'Este link ya fue utilizado' });
    res.json({ valid: true, client_name: result.rows[0].client_name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/roblox/verify/:id', async (req, res) => {
  try {
    const robloxId = req.params.id;
    const userRes = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
    const user = userRes.data;
    const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`);
    const avatar = thumbRes.data.data[0]?.imageUrl || '';
    res.json({
      success: true, username: user.name, displayName: user.displayName,
      avatar, profileUrl: `https://www.roblox.com/users/${robloxId}/profile`
    });
  } catch (err) { res.status(404).json({ error: 'ID de Roblox no encontrado.' }); }
});

app.post('/api/orders/submit', async (req, res) => {
  try {
    const { token, roblox_id, roblox_username, roblox_avatar_url, game_username, game_password, current_level, target_level, user_phone } = req.body;
    const link = await pool.query('SELECT * FROM client_links WHERE link_token = $1 AND is_used = FALSE', [token]);
    if (link.rows.length === 0) return res.status(400).json({ error: 'Link inválido o ya utilizado' });
    const linkData = link.rows[0];

    const result = await pool.query(`
      INSERT INTO orders (link_id, roblox_id, roblox_username, roblox_avatar_url, game_username, game_password, current_level, target_level, employee_id, user_phone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [linkData.id, roblox_id, roblox_username, roblox_avatar_url, game_username, game_password, current_level, target_level, linkData.created_by, user_phone || '']);

    await pool.query('UPDATE client_links SET is_used = TRUE WHERE id = $1', [linkData.id]);

    const waMsg = `🎮 *NamuLiFormat - Nueva Orden*\n\n👤 Usuario: ${linkData.client_name}\n🆔 Roblox: ${roblox_username} (${roblox_id})\n📊 Nivel: ${current_level} → ${target_level}\n👤 User: ${game_username}\n🔒 Pass: ${game_password}\n📱 Tel: ${user_phone || 'N/A'}\n\n⏳ Estado: Pendiente`;

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#1a1a2e;color:#e8e8f0;padding:30px;border-radius:12px;">
        <h2 style="color:#00f5a0;margin:0 0 20px;">🎮 Nueva Orden - NamuLiFormat</h2>
        <div style="background:#12121a;padding:16px;border-radius:8px;margin-bottom:16px;">
          <p style="margin:6px 0;">👤 <strong>Usuario:</strong> ${linkData.client_name}</p>
          <p style="margin:6px 0;">🆔 <strong>Roblox:</strong> ${roblox_username} (${roblox_id})</p>
          <p style="margin:6px 0;">📊 <strong>Nivel:</strong> ${current_level} → <span style="color:#00f5a0;font-weight:bold;">${target_level}</span></p>
          <p style="margin:6px 0;">👤 <strong>User:</strong> ${game_username}</p>
          <p style="margin:6px 0;">🔒 <strong>Pass:</strong> ${game_password}</p>
          <p style="margin:6px 0;">📱 <strong>Tel:</strong> ${user_phone || 'N/A'}</p>
        </div>
        <p style="color:#ffb830;font-weight:bold;">⏳ Estado: Pendiente</p>
        <a href="${process.env.BASE_URL || ''}/admin" style="display:inline-block;background:#00f5a0;color:#0a0a0f;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:12px;">Abrir Panel Admin</a>
      </div>`;

    await notifyAdmin(waMsg, '🎮 Nueva Orden - NamuLiFormat', emailHtml);

    const empMsg = `📋 *NamuLiFormat*\n\nTu usuario ${linkData.client_name} envió su formato.\n🆔 Roblox: ${roblox_username}\n📊 Nivel: ${current_level} → ${target_level}\n\n⏳ Esperando aprobación del admin.`;
    await notifyEmployee(linkData.created_by, empMsg);

    res.json({ success: true, order: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  CODE REQUEST SYSTEM (FAST 2FA)
// ══════════════════════════════════════════════════════════════

// Admin requests a code from user
app.post('/api/codes/request', async (req, res) => {
  try {
    const { order_id, message } = req.body;
    const order = await pool.query(`
      SELECT o.*, cl.client_name FROM orders o 
      JOIN client_links cl ON o.link_id = cl.id WHERE o.id = $1
    `, [order_id]);
    if (order.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });

    const o = order.rows[0];
    const codeToken = uuidv4().split('-')[0];
    
    await pool.query(
      'INSERT INTO code_requests (order_id, code_token, message) VALUES ($1, $2, $3)',
      [order_id, codeToken, message || '⚡ Necesito tu código de verificación AHORA']
    );

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const codeLink = `${baseUrl}/code.html?t=${codeToken}`;

    // Send WhatsApp to user if phone exists
    if (o.user_phone) {
      const waMsg = `⚡ *NamuLiFormat - CÓDIGO URGENTE*\n\n${message || 'Necesito tu código de verificación AHORA'}\n\n🔗 Ingresa tu código aquí:\n${codeLink}\n\n⏱️ ¡Rápido! El código expira pronto.`;
      await sendWhatsAppTo(o.user_phone, waMsg);
    }

    // Also notify employee
    if (o.employee_id) {
      const empMsg = `⚡ *CÓDIGO SOLICITADO*\n\nOrden de ${o.client_name}\n🆔 ${o.roblox_username}\n\nSe pidió código al usuario.\nLink: ${codeLink}`;
      await notifyEmployee(o.employee_id, empMsg);
    }

    res.json({ success: true, codeToken, link: codeLink });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// User submits code
app.post('/api/codes/submit', async (req, res) => {
  try {
    const { token, code } = req.body;
    const result = await pool.query(
      "UPDATE code_requests SET code_value = $1, status = 'received', responded_at = NOW() WHERE code_token = $2 AND status = 'pending' RETURNING *",
      [code, token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada o ya respondida' });

    const codeReq = result.rows[0];

    // Notify admin instantly
    const config = await pool.query('SELECT * FROM admin_config LIMIT 1');
    if (config.rows.length > 0) {
      const waMsg = `🔑 *CÓDIGO RECIBIDO*\n\n📋 Orden #${codeReq.order_id}\n🔐 Código: *${code}*\n\n⚡ ¡Úsalo rápido!`;
      await sendWhatsApp(config.rows[0].whatsapp_phone, waMsg, config.rows[0].whatsapp_apikey);
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Check code status (admin polls this)
app.get('/api/codes/check/:orderId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM code_requests WHERE order_id = $1 ORDER BY created_at DESC LIMIT 5',
      [req.params.orderId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Validate code token (for user page)
app.get('/api/codes/validate/:token', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT cr.*, o.roblox_username, cl.client_name FROM code_requests cr JOIN orders o ON cr.order_id = o.id JOIN client_links cl ON o.link_id = cl.id WHERE cr.code_token = $1",
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const cr = result.rows[0];
    res.json({ 
      valid: true, 
      status: cr.status, 
      message: cr.message, 
      client_name: cr.client_name,
      roblox_username: cr.roblox_username
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  QUICK CHAT (Admin <-> Employee)
// ══════════════════════════════════════════════════════════════
app.post('/api/chat/send', async (req, res) => {
  try {
    const { sender_type, sender_name, message } = req.body;
    const result = await pool.query(
      'INSERT INTO quick_chat (sender_type, sender_name, message) VALUES ($1, $2, $3) RETURNING *',
      [sender_type, sender_name, message]
    );

    // Notify via WhatsApp
    const config = await pool.query('SELECT * FROM admin_config LIMIT 1');
    if (config.rows.length > 0 && config.rows[0].whatsapp_apikey) {
      if (sender_type === 'employee') {
        // Employee sent → notify admin
        const waMsg = `💬 *Chat - ${sender_name}*\n\n${message}`;
        await sendWhatsApp(config.rows[0].whatsapp_phone, waMsg, config.rows[0].whatsapp_apikey);
      } else if (sender_type === 'admin') {
        // Admin sent → notify all employees with phone
        const emps = await pool.query('SELECT phone FROM employees WHERE phone IS NOT NULL AND phone != \'\'');
        for (const emp of emps.rows) {
          const waMsg = `💬 *Chat - Admin*\n\n${message}`;
          await sendWhatsApp(emp.phone, waMsg, config.rows[0].whatsapp_apikey);
        }
      }
    }

    res.json({ success: true, chat: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/chat/messages', async (req, res) => {
  try {
    const after = req.query.after || '1970-01-01';
    const result = await pool.query(
      'SELECT * FROM quick_chat WHERE created_at > $1 ORDER BY created_at ASC LIMIT 100',
      [after]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, cl.client_name, cl.link_token, e.username as employee_name
      FROM orders o JOIN client_links cl ON o.link_id = cl.id 
      LEFT JOIN employees e ON o.employee_id = e.id ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/orders/:id', async (req, res) => {
  try {
    const { status, admin_notes, subscription_months } = req.body;
    const ROBLOX_TIMER_TOKEN = process.env.ROBLOX_TIMER_ADMIN_TOKEN || 'aDm1n_RblxT1m3r_T0k3n_2026_qW7z';

    const result = await pool.query(
      'UPDATE orders SET status = $1, admin_notes = $2, subscription_months = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [status, admin_notes || '', subscription_months || 1, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    const order = result.rows[0];
    const link = await pool.query('SELECT client_name FROM client_links WHERE id = $1', [order.link_id]);
    const userName = link.rows[0]?.client_name || 'Usuario';

    const statusEmojis = { pendiente:'⏳', aceptada:'✅', en_proceso:'🔄', completada:'🏆', denegada:'❌' };
    const statusNames = { pendiente:'Pendiente', aceptada:'Aceptada', en_proceso:'En Proceso', completada:'Completada', denegada:'Denegada' };

    // Generar token si status = completada (permite regenerar si no tiene token)
    if (status === 'completada' && !order.access_token) {
      try {
        const tokenResponse = await axios.post(
          'https://roblox-timer.namu-li.com/admin/tokens/generate',
          {
            name: userName,
            months: order.subscription_months || 1,
            roblox_ids: [order.roblox_id],
            device_name: `${userName} - ${order.roblox_username}`
          },
          {
            headers: {
              'Authorization': `Bearer ${ROBLOX_TIMER_TOKEN}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        if (tokenResponse.data.success) {
          const { token, install_url } = tokenResponse.data;

          await pool.query(
            'UPDATE orders SET access_token = $1, install_url = $2 WHERE id = $3',
            [token, install_url, req.params.id]
          );

          order.access_token = token;
          order.install_url = install_url;

          console.log(`✅ Token generado para orden #${req.params.id}: ${token}`);
        } else {
          // Si la API respondio pero sin exito, revertir status
          await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['en_proceso', req.params.id]);
          return res.status(500).json({ error: 'Error al generar token: ' + (tokenResponse.data.error || 'respuesta invalida') });
        }
      } catch (tokenErr) {
        console.error('❌ Error generando token:', tokenErr.message);
        // Revertir status para que el admin sepa que fallo
        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['en_proceso', req.params.id]);
        return res.status(500).json({ error: 'No se pudo generar el token de acceso. Intenta de nuevo.' });
      }
    }

    if (order.employee_id) {
      const empMsg = `${statusEmojis[status]||'📋'} *NamuLiFormat*\n\nOrden de ${userName}:\n🆔 ${order.roblox_username}\n📊 ${order.current_level} → ${order.target_level}\n\n🔄 Estado: *${statusNames[status]||status}*${admin_notes?'\n📝 '+admin_notes:''}`;
      await notifyEmployee(order.employee_id, empMsg);
    }

    if (order.user_phone) {
      let userMsg = `${statusEmojis[status]||'📋'} *NamuLiFormat*\n\nTu orden ha sido actualizada:\n📊 Nivel: ${order.current_level} → ${order.target_level}\n🔄 Estado: *${statusNames[status]||status}*${admin_notes?'\n📝 '+admin_notes:''}`;

      if (status === 'completada' && order.install_url) {
        userMsg += `\n\n🎉 *¡CUENTA LISTA!*\n\n🔑 Tu acceso al AutoFarm ha sido generado:\n\n📥 *INSTRUCCIONES:*\n1. Abre este link: ${order.install_url}\n2. Descarga el instalador\n3. Ejecuta e instala tu acceso\n4. Abre AutoFarmNamuLi y disfruta!\n\n⚠️ Guarda bien este link, solo funciona en tu PC.`;
      }

      await sendWhatsAppTo(order.user_phone, userMsg);
    }

    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/employees', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, phone, created_at FROM employees ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/employees', async (req, res) => {
  try {
    const { username, password, phone } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO employees (username, password_hash, phone) VALUES ($1, $2, $3) RETURNING id, username, phone, created_at',
      [username, hash, phone || '']
    );
    res.json({ success: true, employee: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ese usuario ya existe' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/employees/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/config', async (req, res) => {
  try {
    const { whatsapp_phone, whatsapp_apikey, employee_whatsapp_apikey, email_to, email_from, email_app_password, new_password } = req.body;
    let query = 'UPDATE admin_config SET whatsapp_phone=$1, whatsapp_apikey=$2, employee_whatsapp_apikey=$3, email_to=$4, email_from=$5, email_app_password=$6';
    let params = [whatsapp_phone, whatsapp_apikey, employee_whatsapp_apikey, email_to, email_from, email_app_password];
    if (new_password) {
      const hash = await bcrypt.hash(new_password, 10);
      query += ', admin_password_hash=$7';
      params.push(hash);
    }
    query += ' WHERE id=1';
    await pool.query(query, params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/config', async (req, res) => {
  try {
    const result = await pool.query('SELECT whatsapp_phone, whatsapp_apikey, employee_whatsapp_apikey, email_to, email_from, email_app_password FROM admin_config LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/links', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cl.*, e.username as employee_name FROM client_links cl 
      LEFT JOIN employees e ON cl.created_by = e.id ORDER BY cl.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM orders');
    const pending = await pool.query("SELECT COUNT(*) FROM orders WHERE status='pendiente'");
    const completed = await pool.query("SELECT COUNT(*) FROM orders WHERE status='completada'");
    const inProcess = await pool.query("SELECT COUNT(*) FROM orders WHERE status='en_proceso'");
    res.json({
      total: parseInt(total.rows[0].count), pending: parseInt(pending.rows[0].count),
      completed: parseInt(completed.rows[0].count), in_process: parseInt(inProcess.rows[0].count)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Page routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/employee', (req, res) => res.sendFile(path.join(__dirname, 'public', 'employee.html')));
app.get('/form', (req, res) => res.sendFile(path.join(__dirname, 'public', 'form.html')));
app.get('/code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'code.html')));

// Panel routes con tokens unicos
app.get('/p/qdjyrdzquukba4vc', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/p/twszb5m4cqrsfn0z', (req, res) => res.sendFile(path.join(__dirname, 'public', 'employee.html')));

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎮 NamuLiFormat corriendo en puerto ${PORT}`);
    console.log(`📋 Admin: http://localhost:${PORT}/admin`);
    console.log(`👷 Empleado: http://localhost:${PORT}/employee\n`);
  });
}).catch(err => { console.error('Error al iniciar DB:', err); process.exit(1); });
