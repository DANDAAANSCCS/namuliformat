# 🎮 NamuLiFormat

Sistema automatizado de gestión de órdenes AutoFarm para Roblox con notificaciones WhatsApp.

---

## 🚀 Deploy en Railway (Paso a Paso)

### 1. Sube el código a GitHub

```bash
git init
git add .
git commit -m "NamuLiFormat v1.0"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/namuliformat.git
git push -u origin main
```

### 2. Crea el proyecto en Railway

1. Ve a [railway.app](https://railway.app) e inicia sesión
2. Click en **"New Project"**
3. Selecciona **"Deploy from GitHub repo"**
4. Selecciona tu repositorio `namuliformat`

### 3. Agrega PostgreSQL

1. En tu proyecto de Railway, click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
2. Railway conectará automáticamente la variable `DATABASE_URL`

### 4. Configura Variables de Entorno

En Railway ve a tu servicio → **Variables** y agrega:

| Variable | Valor |
|---|---|
| `ADMIN_PASSWORD` | `tu_contraseña_segura` |
| `EMPLOYEE_PASSWORD` | `contraseña_empleado` |
| `ADMIN_WHATSAPP` | `+528121968034` |
| `BASE_URL` | `https://tu-app.up.railway.app` (lo obtienes después del deploy) |
| `NODE_ENV` | `production` |

### 5. Genera el dominio público

1. En tu servicio → **Settings** → **Networking**
2. Click **"Generate Domain"**
3. Copia la URL y actualiza `BASE_URL` en las variables

### 6. ¡Listo!

Tu app estará corriendo en `https://tu-app.up.railway.app`

---

## 📱 Configurar Notificaciones WhatsApp (CallMeBot)

### Para tu número (Admin):

1. Guarda este contacto en tu teléfono: **+34 644 51 84 88** (CallMeBot)
2. Envíale por WhatsApp: `I allow callmebot to send me messages`
3. Recibirás un mensaje con tu **API Key**
4. Ve al panel admin → Configuración → Pega tu número y API Key

### Para tu empleado:

1. Tu empleado repite el mismo proceso con su teléfono
2. Te da su API Key
3. Lo configuras en el panel admin → Configuración → "API Key Empleado"

---

## 🔐 Accesos por defecto

| Panel | URL | Credenciales |
|---|---|---|
| **Admin** | `/admin` | Contraseña: `admin123` (cámbiala!) |
| **Empleado** | `/employee` | Usuario: `empleado1` / Pass: `empleado123` |
| **Cliente** | `/form.html?token=XXX` | Link único generado por empleado |

---

## 📋 Flujo del Sistema

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  EMPLEADO   │────▶│  GENERA LINK │────▶│  CLIENTE   │
│  /employee  │     │   único      │     │  /form     │
└─────────────┘     └──────────────┘     └─────┬──────┘
                                               │
                                          Llena formato
                                          + Verifica ID
                                          de Roblox
                                               │
                                               ▼
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│   ADMIN     │◀────│  WhatsApp    │◀────│   ORDEN    │
│   /admin    │     │  Notifica    │     │  Creada    │
└──────┬──────┘     └──────────────┘     └────────────┘
       │
  Acepta/Deniega
  Cambia estado
       │
       ▼
┌──────────────┐
│  WhatsApp    │───▶ Notifica al empleado
│  Notifica    │
└──────────────┘
```

---

## 🛠️ Desarrollo Local

```bash
# Instalar dependencias
npm install

# Crear .env desde ejemplo
cp .env.example .env
# Editar .env con tus datos y una URL de PostgreSQL local

# Ejecutar
npm start
```

---

## 📁 Estructura

```
namuliformat/
├── server.js           # Backend completo (Express + API + DB)
├── package.json
├── railway.json        # Config de Railway
├── .env.example        # Variables de entorno
├── .gitignore
└── public/
    ├── index.html      # Landing page
    ├── admin.html      # Panel administrador
    ├── employee.html   # Panel empleado
    ├── form.html       # Formato del cliente (link único)
    └── css/
        └── style.css   # Estilos gaming/cyberpunk
```
