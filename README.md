

# Vídeo de apresentação
https://drive.google.com/file/d/1Qq9arMPVKtbqYCwA-cmlTUFde8rzo75H/view?usp=sharing

# Dependências
```
npm install axios cheerio prompt-sync
npm install -D typescript @types/node
npx tsc --init
npm install -D ts-node
```

# [1] Execução typescript
```npx ts-node engine.ts```

# [2] Transpilar javascript
```npx tsc```

# Configurações extras em 'tsconfig.json'
```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "allowJs": true,
  }
}
```
