const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'logo.png']) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.cpSync(path.join(root, 'web'), output, { recursive: true });
// O coletor pequeno fica no HTML para não disputar uma requisição antes da página aparecer.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'web/analytics.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(path.join(output, 'index.html'), html.replace('<script defer src="/analytics.js"></script>', '<script>\n' + analytics + '\n</script>'));
console.log('Static app built in public/.');
