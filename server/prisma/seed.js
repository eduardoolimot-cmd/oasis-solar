// =================================================
// OASIS SOLAR — Seed de dados iniciais
// =================================================
// Popula o banco com:
//   - 1 admin (admin@oasis.local / admin123)
//   - 3 usinas com módulos, inversores e previsões anuais
//   - lançamentos de dezembro/2024
//   - manutenções distribuídas no Kanban
//   - lançamentos financeiros
//   - notificações
//
// Uso: npm run db:seed
// =================================================

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Bloqueia o seed em produção (a menos que SEED_FORCE=true)
if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
  console.error('❌ Seed bloqueado em produção. Use SEED_FORCE=true se realmente desejar.');
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@oasis.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Constantes (mesmas do oasis-solar_9.html)
const MO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

async function main() {
  console.log('🌱 Iniciando seed...\n');

  // ---------- 0. Limpeza (idempotência) ----------
  console.log('🧹 Limpando dados anteriores...');
  await prisma.auditLog.deleteMany();
  await prisma.notificacao.deleteMany();
  await prisma.arquivo.deleteMany();
  await prisma.financeiro.deleteMany();
  await prisma.manutencao.deleteMany();
  await prisma.lancamento.deleteMany();
  await prisma.previsao.deleteMany();
  await prisma.skid.deleteMany();
  await prisma.usina.deleteMany();
  await prisma.user.deleteMany();

  // ---------- 1. Usuário admin ----------
  console.log('👤 Criando usuário admin...');
  const senhaHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      senhaHash,
      nome: 'Administrador',
      role: 'ADMIN',
      ativo: true,
    },
  });
  console.log(`   ✓ ${admin.email} (role: ${admin.role})`);

  // Usuário técnico de exemplo
  const tecnico = await prisma.user.create({
    data: {
      email: 'tecnico@oasis.local',
      senhaHash: await bcrypt.hash('tecnico123', 10),
      nome: 'Técnico Solar',
      role: 'TECNICO',
      ativo: true,
    },
  });
  console.log(`   ✓ ${tecnico.email} (role: ${tecnico.role})`);

  // Usuário visualizador de exemplo
  const visualizador = await prisma.user.create({
    data: {
      email: 'view@oasis.local',
      senhaHash: await bcrypt.hash('view123', 10),
      nome: 'Visualizador',
      role: 'VISUALIZADOR',
      ativo: true,
    },
  });
  console.log(`   ✓ ${visualizador.email} (role: ${visualizador.role})`);

  // ---------- 2. Usinas ----------
  console.log('\n🌞 Criando usinas...');

  const ufv = await prisma.usina.create({
    data: {
      nome: 'UFV Central',
      kwp: 6800,
      inicio: new Date('2023-12-31T00:00:00.000Z'),
      local: 'Aracruz – ES',
      obs: 'Usina principal de operação',
      moduloModelo: 'Canadian Solar 400W',
      moduloQtd: 3750,
      moduloW: 400,
      moduloFab: 'Canadian Solar',
      inversorModelo: 'Sungrow SG110CX',
      inversorQtd: 14,
      inversorKw: 110,
      inversorFab: 'Sungrow',
      previsoes: {
        create: MO.map((_, i) => ({
          mes: i + 1,
          gen: 84148,
          irrad: 176.3,
          pr: 81,
        })),
      },
    },
  });

  const colatina = await prisma.usina.create({
    data: {
      nome: 'Usina Colatina II',
      kwp: 1800,
      inicio: new Date('2022-03-01T00:00:00.000Z'),
      local: 'Colatina – ES',
      obs: '',
      moduloModelo: 'Jinko 450W',
      moduloQtd: 4000,
      moduloW: 450,
      moduloFab: 'Jinko',
      inversorModelo: 'SMA Symo',
      inversorQtd: 15,
      inversorKw: 120,
      inversorFab: 'SMA',
      previsoes: {
        create: MO.map((_, i) => ({
          mes: i + 1,
          gen: 16000 + i * 200,
          irrad: 165 + i * 1.5,
          pr: 82,
        })),
      },
    },
  });

  const vitoria = await prisma.usina.create({
    data: {
      nome: 'Usina Vitória III',
      kwp: 900,
      inicio: new Date('2022-06-15T00:00:00.000Z'),
      local: 'Vitória – ES',
      obs: '',
      moduloModelo: 'BYD 380W',
      moduloQtd: 2400,
      moduloW: 380,
      moduloFab: 'BYD',
      inversorModelo: 'Fronius Symo',
      inversorQtd: 10,
      inversorKw: 90,
      inversorFab: 'Fronius',
      previsoes: {
        create: MO.map((_, i) => ({
          mes: i + 1,
          gen: 8000,
          irrad: 162,
          pr: 79,
        })),
      },
    },
  });

  console.log(`   ✓ ${ufv.nome} (${ufv.kwp} kWp)`);
  console.log(`   ✓ ${colatina.nome} (${colatina.kwp} kWp)`);
  console.log(`   ✓ ${vitoria.nome} (${vitoria.kwp} kWp)`);

  // ---------- 3. Lançamentos ----------
  console.log('\n⚡ Criando lançamentos de geração...');
  const lancamentos = [
    { usinaId: ufv.id, periodo: '2024-12', geracao: 185420, irrad: 164.5, pr: 82.5, disp: 97.8 },
    { usinaId: colatina.id, periodo: '2024-12', geracao: 215000, irrad: 168.4, pr: 83.1, disp: 98.2 },
    { usinaId: vitoria.id, periodo: '2024-12', geracao: 88000, irrad: 162.1, pr: 79.4, disp: 94.1, obs: 'Sombreamento parcial' },
  ];
  for (const l of lancamentos) {
    await prisma.lancamento.create({
      data: { ...l, criadoPorId: admin.id },
    });
  }
  console.log(`   ✓ ${lancamentos.length} lançamentos criados`);

  // ---------- 4. Manutenções ----------
  console.log('\n🔧 Criando ordens de manutenção...');
  const manutencoes = [
    {
      usinaId: ufv.id, tipo: 'prev', status: 'ok',
      titulo: 'Limpeza dos módulos', data: new Date('2024-12-15'),
      resp: 'Carlos Silva', comp: 'Campo completo',
      detalhe: 'Limpeza completa com água deionizada.',
    },
    {
      usinaId: vitoria.id, tipo: 'corr', status: 'ok',
      titulo: 'Substituição de inversor', data: new Date('2024-12-02'),
      resp: 'João Santos', comp: 'Inversor #7',
      detalhe: 'Falha de comunicação. Substituído.',
    },
    {
      usinaId: colatina.id, tipo: 'plan', status: 'plan',
      titulo: 'Inspeção termográfica', data: new Date('2025-01-15'),
      resp: 'Equipe Técnica', comp: 'Campo completo',
      detalhe: 'Drone termográfico.',
    },
    {
      usinaId: ufv.id, tipo: 'plan', status: 'exec',
      titulo: 'Revisão anual dos inversores', data: new Date('2025-01-20'),
      resp: 'Sungrow', comp: 'Todos os inversores',
      detalhe: 'Revisão preventiva anual.',
    },
  ];
  for (const m of manutencoes) {
    await prisma.manutencao.create({
      data: { ...m, criadoPorId: admin.id },
    });
  }
  console.log(`   ✓ ${manutencoes.length} ordens criadas`);

  // ---------- 5. Financeiro ----------
  console.log('\n💰 Criando lançamentos financeiros...');
  const financeiros = [
    { usinaId: ufv.id, tipo: 'rec', data: new Date('2024-12-31'), cat: 'Energia Gerada', desc: 'Geração dez/24', val: 139065, st: 'pg' },
    { usinaId: ufv.id, tipo: 'des', data: new Date('2024-12-15'), cat: 'Manutenção', desc: 'Limpeza dos módulos', val: 3500, st: 'pg' },
    { usinaId: colatina.id, tipo: 'rec', data: new Date('2024-12-31'), cat: 'Energia Gerada', desc: 'Geração dez/24', val: 154800, st: 'pg' },
    { usinaId: vitoria.id, tipo: 'rec', data: new Date('2024-12-31'), cat: 'Energia Gerada', desc: 'Geração dez/24', val: 61600, st: 'pg' },
    { usinaId: ufv.id, tipo: 'des', data: new Date('2024-12-31'), cat: 'O&M', desc: 'Contrato O&M', val: 8000, st: 'pg' },
    { usinaId: ufv.id, tipo: 'des', data: new Date('2025-01-20'), cat: 'Manutenção', desc: 'Revisão inversores', val: 12000, st: 'pend' },
  ];
  for (const f of financeiros) {
    await prisma.financeiro.create({
      data: { ...f, criadoPorId: admin.id },
    });
  }
  console.log(`   ✓ ${financeiros.length} lançamentos financeiros`);

  // ---------- 6. Notificações ----------
  console.log('\n🔔 Criando notificações...');
  const notificacoes = [
    { titulo: 'Geração abaixo do previsto', body: 'Usina Vitória III — PR 79.4% vs meta 81%', tipo: 'wn', lida: false },
    { titulo: 'Manutenção planejada', body: 'Inspeção termográfica em 15/01/2025', tipo: 'info', lida: false },
    { titulo: 'Importação concluída', body: '12 registros importados via planilha', tipo: 'ok', lida: true },
  ];
  for (const n of notificacoes) {
    await prisma.notificacao.create({ data: n });
  }
  console.log(`   ✓ ${notificacoes.length} notificações`);

  // ---------- Sumário ----------
  console.log('\n✅ Seed concluído!');
  console.log('\n📋 Resumo:');
  console.log(`   Usuários:        ${await prisma.user.count()}`);
  console.log(`   Usinas:          ${await prisma.usina.count()}`);
  console.log(`   Previsões:       ${await prisma.previsao.count()}`);
  console.log(`   Lançamentos:     ${await prisma.lancamento.count()}`);
  console.log(`   Manutenções:     ${await prisma.manutencao.count()}`);
  console.log(`   Financeiros:     ${await prisma.financeiro.count()}`);
  console.log(`   Notificações:    ${await prisma.notificacao.count()}`);
  console.log('\n🔑 Credenciais de acesso:');
  console.log(`   ADMIN:        ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`   TECNICO:      tecnico@oasis.local / tecnico123`);
  console.log(`   VISUALIZADOR: view@oasis.local / view123`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
