# Orbit Capital (Frontend + Backend)

Isang server na lang — frontend at backend magkasama.

## Paano patakbuhin sa Laptop + Phone (walang IP address)

### 1. Install dependencies (isang beses lang)
```bash
cd orbit-backend
npm install
```

### 2. Patakbuhin ang server
```bash
npm start
```

Makikita mo:
```
🚀 Orbit Capital running!
   Local  : http://localhost:3000
```

### 3. Gumawa ng public link (para sa phone)

Buksan ang **bagong CMD/PowerShell** at i-run:

```bash
npx localtunnel --port 3000
```

Makakakuha ka ng link na ganito:
```
your url is: https://funny-cat-12.loca.lt
```

### 4. Buksan sa phone
1. Kopyahin ang link (`https://....loca.lt`)
2. I-paste sa Chrome / Safari ng phone mo
3. Kapag may "Click to continue" / password → pindutin lang (libre ito)
4. Ready na ang app!

---

## Alternative: ngrok (mas stable)

```bash
ngrok http 3000
```

Gamitin ang `https://xxxx.ngrok-free.app` link.

---

## Notes
- Hindi na kailangan baguhin ang API_URL — automatic na.
- Parehong WiFi **hindi** kailangan kapag gumagamit ng localtunnel/ngrok.
- Para sa production (maraming users), i-deploy sa Render / Railway.
