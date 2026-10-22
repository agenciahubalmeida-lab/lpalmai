const { uuid } = require('./http');
const OPTIONS = {
  atende: { 'Eu mesmo': 1, 'Uma pessoa do time': 2, 'Um time comercial': 3, 'Ninguém dá conta de tudo': 2 },
  espera: { 'Menos de 5 minutos': 0, 'Até 1 hora': 1, 'Algumas horas': 2, 'Às vezes só no outro dia': 2 },
  leads: { 'Até 100': 0, 'De 100 a 500': 2, 'De 500 a 2.000': 3, 'Mais de 2.000': 3 },
  investimento: { 'Sim, se resolver, faz sentido': 4, 'Quero entender o retorno antes': 2, 'Agora não cabe': -20 },
};
const SEGMENTS = ['Infoproduto e cursos', 'Serviços e consultoria', 'Clínica, saúde e estética', 'E-commerce e varejo', 'Imóveis e veículos', 'Outro'];
const LOSSES = {
  'Demora no primeiro atendimento': 'sdr',
  'Tempo gasto com lead que não tem perfil': 'sdr',
  'Follow-up que ninguém faz': 'closer',
  'Pix, boleto ou carrinho abandonado': 'rec',
  'Suporte tomando o tempo do comercial': 'sup',
  'A venda depende de um vendedor específico': 'closer',
};
function text(value, min, max, label) {
  if (typeof value !== 'string') throw Error('Confira ' + label + '.');
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (result.length < min || result.length > max) throw Error('Confira ' + label + '.');
  return result;
}
function phone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (!/^[1-9]{2}(?:[2-5]\d{7}|9\d{8})$/.test(digits)) throw Error('Coloque um WhatsApp válido, com DDD.');
  return '55' + digits;
}
function validateLead(input) {
  if (!uuid(input.submission_id)) throw Error('Atualize a página e tente novamente.');
  const answers = input.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw Error('Confira as respostas do diagnóstico.');
  const clean = {};
  let score = 0;
  for (const key of Object.keys(OPTIONS)) {
    if (typeof answers[key] !== 'string' || !Object.hasOwn(OPTIONS[key], answers[key])) throw Error('Confira as respostas do diagnóstico.');
    clean[key] = answers[key];
    score += OPTIONS[key][answers[key]];
  }
  if (!SEGMENTS.includes(answers.segmento)) throw Error('Escolha o seu segmento.');
  clean.segmento = answers.segmento;
  if (!Array.isArray(answers.perdas) || !answers.perdas.length || answers.perdas.length > 6 || answers.perdas.some(v => !Object.hasOwn(LOSSES, v))) throw Error('Marque onde você perde vendas.');
  clean.perdas = [...new Set(answers.perdas)];
  const counts = {};
  clean.perdas.forEach(v => { counts[LOSSES[v]] = (counts[LOSSES[v]] || 0) + 1; });
  const team = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (!team.includes('sdr') && OPTIONS.espera[clean.espera] >= 2) team.unshift('sdr');
  const tier = OPTIONS.investimento[clean.investimento] < 0 ? 'baixo' : score >= 9 ? 'alto' : score >= 5 ? 'medio' : 'baixo';
  const utm = {};
  if (input.utm && typeof input.utm === 'object') for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id']) {
    if (typeof input.utm[key] === 'string') utm[key] = input.utm[key].slice(0, 200);
  }
  return {
    submission_id: input.submission_id.toLowerCase(),
    nome: text(input.nome, 2, 100, 'o seu nome'),
    empresa: text(input.empresa, 1, 160, 'o nome da empresa'),
    whatsapp: phone(input.whats),
    instagram: text(input.ig || '', 0, 300, 'o Instagram ou site'),
    respostas: clean, tier, team: team.slice(0, 3), utm,
    source_url: (process.env.ALM_PUBLIC_ORIGIN || 'https://lpalmai.hubalmeida.com.br') + '/',
    referrer: typeof input.referrer === 'string' ? input.referrer.slice(0, 500) : '',
  };
}
module.exports = { validateLead, phone, OPTIONS, SEGMENTS, LOSSES };
