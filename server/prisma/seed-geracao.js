// =================================================
// Importa lançamentos de geração mensal Jan–Abr/2026
// a partir do arquivo "usinas_energia_solar.txt"
// =================================================
// - Cria automaticamente 5 usinas novas que aparecem no arquivo
//   (com SKIDs) caso ainda não existam.
// - Cria os SKIDs faltantes para qualquer usina.
// - Insere/atualiza 104 lançamentos (upsert manual).
// - PRESERVA usinas, usuários, manutenções e financeiros existentes.
// =================================================
// Uso: node prisma/seed-geracao.js
//      ou: npm run db:seed-geracao
// =================================================

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ---------- Configuração das novas usinas ----------
// kWp aproximado por usina (baseado nos volumes mensais do CSV).
// Início = 2024-01-01 (com idade ~2 anos em 2026 → ~2% de degradação).
const NOVAS_USINAS = [
  {
    nome: 'UFV Central',
    kwp: 6800,
    inicio: new Date(Date.UTC(2024, 0, 1)),
    skids: ['SKID F1', 'SKID F2', 'SKID F3', 'SKID F4', 'SKID F5'],
  },
  {
    nome: 'UFV Sítio do Pescoço',
    kwp: 4000,
    inicio: new Date(Date.UTC(2024, 0, 1)),
    skids: ['USINA1.1', 'USINA1.2', 'USINA1.3', 'USINA1.4'],
  },
  {
    nome: 'UFV Partinga-BA',
    kwp: 8500,
    inicio: new Date(Date.UTC(2024, 0, 1)),
    skids: ['SKID1', 'SKID2', 'SKID3', 'SKID4', 'SKID5'],
  },
  {
    nome: 'UFV Pedro Canario I',
    kwp: 3500,
    inicio: new Date(Date.UTC(2024, 0, 1)),
    skids: ['SKID1', 'SKID2', 'SKID3'],
  },
  {
    nome: 'UFV Pedro Canario II',
    kwp: 3000,
    inicio: new Date(Date.UTC(2024, 0, 1)),
    skids: ['SKID1', 'SKID2', 'SKID3'],
  },
];

// ---------- Lançamentos do CSV (104 entradas) ----------
const LANCAMENTOS = [
  // -------- JANEIRO / 2026 --------
  { periodo: '2026-01', usina: 'UFV Central',           skid: 'SKID F1', gen: 174345.0, irrad: 159.9, pr: 87.6 },
  { periodo: '2026-01', usina: 'UFV Central',           skid: 'SKID F2', gen: 193680.0, irrad: 159.9, pr: 87.6 },
  { periodo: '2026-01', usina: 'UFV Central',           skid: 'SKID F3', gen: 194698.6, irrad: 159.9, pr: 87.6 },
  { periodo: '2026-01', usina: 'UFV Central',           skid: 'SKID F4', gen: 198488.9, irrad: 159.9, pr: 87.6 },
  { periodo: '2026-01', usina: 'UFV Central',           skid: 'SKID F5', gen: 193430.4, irrad: 159.9, pr: 87.6 },
  { periodo: '2026-01', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.1', gen: 154816.7, irrad: 165.5, pr: 80.7 },
  { periodo: '2026-01', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.2', gen: 185967.2, irrad: 165.5, pr: 82.3 },
  { periodo: '2026-01', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.3', gen: 89969.4,  irrad: 165.5, pr: 85.4 },
  { periodo: '2026-01', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.4', gen: 64523.4,  irrad: 165.5, pr: 97.0 },
  { periodo: '2026-01', usina: 'UFV Partinga-BA',       skid: 'SKID1', gen: 224142.5, irrad: 208.2, pr: 75.8 },
  { periodo: '2026-01', usina: 'UFV Partinga-BA',       skid: 'SKID2', gen: 211856.4, irrad: 208.2, pr: 75.8 },
  { periodo: '2026-01', usina: 'UFV Partinga-BA',       skid: 'SKID3', gen: 232669.0, irrad: 208.2, pr: 75.8 },
  { periodo: '2026-01', usina: 'UFV Partinga-BA',       skid: 'SKID4', gen: 221124.4, irrad: 208.2, pr: 75.8 },
  { periodo: '2026-01', usina: 'UFV Partinga-BA',       skid: 'SKID5', gen: 235261.7, irrad: 208.2, pr: 75.8 },
  { periodo: '2026-01', usina: 'UFV Bom Futuro',        skid: null,    gen: 10474.3,  irrad: 121.5, pr: 62.1 },
  { periodo: '2026-01', usina: 'UFV Cerado Pedra I',    skid: null,    gen: 16986.1,  irrad: 121.5, pr: 100.7 },
  { periodo: '2026-01', usina: 'UFV Cercado Pedra II',  skid: null,    gen: 17163.7,  irrad: 207.7, pr: 78.0 },
  { periodo: '2026-01', usina: 'UFV Cercado Pedra III', skid: null,    gen: 16807.0,  irrad: 121.5, pr: 99.7 },
  { periodo: '2026-01', usina: 'UFV Efizi',             skid: null,    gen: 15258.2,  irrad: 121.5, pr: 90.5 },
  { periodo: '2026-01', usina: 'UFV Pedro Canario I',   skid: 'SKID1', gen: 210695.6, irrad: 220.4, pr: 83.3 },
  { periodo: '2026-01', usina: 'UFV Pedro Canario I',   skid: 'SKID2', gen: 199967.7, irrad: 220.4, pr: 83.3 },
  { periodo: '2026-01', usina: 'UFV Pedro Canario I',   skid: 'SKID3', gen: 104068.7, irrad: 220.4, pr: 83.3 },
  { periodo: '2026-01', usina: 'UFV Pedro Canario II',  skid: 'SKID1', gen: 96559.7,  irrad: 220.4, pr: 50.0 },
  { periodo: '2026-01', usina: 'UFV Pedro Canario II',  skid: 'SKID2', gen: 171117.3, irrad: 220.4, pr: 50.0 },
  { periodo: '2026-01', usina: 'UFV Pedro Canario II',  skid: 'SKID3', gen: 167084.6, irrad: 220.4, pr: 50.0 },

  // -------- FEVEREIRO / 2026 --------
  { periodo: '2026-02', usina: 'UFV Central',           skid: 'SKID F1', gen: 159480.0, irrad: 138.5, pr: 86.6 },
  { periodo: '2026-02', usina: 'UFV Central',           skid: 'SKID F2', gen: 165320.0, irrad: 138.5, pr: 86.6 },
  { periodo: '2026-02', usina: 'UFV Central',           skid: 'SKID F3', gen: 164880.0, irrad: 138.5, pr: 86.6 },
  { periodo: '2026-02', usina: 'UFV Central',           skid: 'SKID F4', gen: 165130.0, irrad: 138.5, pr: 86.6 },
  { periodo: '2026-02', usina: 'UFV Central',           skid: 'SKID F5', gen: 162930.0, irrad: 138.5, pr: 86.6 },
  { periodo: '2026-02', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.1', gen: 165673.0, irrad: 158.8, pr: 79.0 },
  { periodo: '2026-02', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.2', gen: 152815.6, irrad: 158.8, pr: 58.4 },
  { periodo: '2026-02', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.3', gen: 44208.9,  irrad: 158.8, pr: 80.6 },
  { periodo: '2026-02', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.4', gen: 74885.0,  irrad: 132.3, pr: 80.6 },
  { periodo: '2026-02', usina: 'UFV Partinga-BA',       skid: 'SKID1', gen: 182589.6, irrad: 162.5, pr: 78.5 },
  { periodo: '2026-02', usina: 'UFV Partinga-BA',       skid: 'SKID2', gen: 181670.5, irrad: 162.5, pr: 78.5 },
  { periodo: '2026-02', usina: 'UFV Partinga-BA',       skid: 'SKID3', gen: 183862.1, irrad: 162.5, pr: 78.5 },
  { periodo: '2026-02', usina: 'UFV Partinga-BA',       skid: 'SKID4', gen: 175924.1, irrad: 162.5, pr: 78.5 },
  { periodo: '2026-02', usina: 'UFV Partinga-BA',       skid: 'SKID5', gen: 185181.4, irrad: 162.5, pr: 78.5 },
  { periodo: '2026-02', usina: 'UFV Bom Futuro',        skid: null,    gen: 9758.8,   irrad: 132.3, pr: 67.8 },
  { periodo: '2026-02', usina: 'UFV Cerado Pedra I',    skid: null,    gen: 14942.6,  irrad: 132.3, pr: 103.9 },
  { periodo: '2026-02', usina: 'UFV Cercado Pedra II',  skid: null,    gen: 15219.3,  irrad: 176.3, pr: 78.0 },
  { periodo: '2026-02', usina: 'UFV Cercado Pedra III', skid: null,    gen: 15548.0,  irrad: 132.3, pr: 108.0 },
  { periodo: '2026-02', usina: 'UFV Efizi',             skid: null,    gen: 13772.1,  irrad: 132.3, pr: 95.7 },
  { periodo: '2026-02', usina: 'UFV Pedro Canario I',   skid: 'SKID1', gen: 199942.4, irrad: 220.4, pr: 60.0 },
  { periodo: '2026-02', usina: 'UFV Pedro Canario I',   skid: 'SKID2', gen: 194185.5, irrad: 220.4, pr: 60.0 },
  { periodo: '2026-02', usina: 'UFV Pedro Canario I',   skid: 'SKID3', gen: 101663.0, irrad: 220.4, pr: 60.0 },
  { periodo: '2026-02', usina: 'UFV Pedro Canario II',  skid: 'SKID1', gen: 99252.1,  irrad: 220.4, pr: 72.0 },
  { periodo: '2026-02', usina: 'UFV Pedro Canario II',  skid: 'SKID2', gen: 172457.1, irrad: 220.4, pr: 72.0 },
  { periodo: '2026-02', usina: 'UFV Pedro Canario II',  skid: 'SKID3', gen: 170462.0, irrad: 220.4, pr: 72.0 },

  // -------- MARÇO / 2026 --------
  { periodo: '2026-03', usina: 'UFV Central',           skid: 'SKID F1', gen: 200651.0, irrad: 176.6, pr: 82.7 },
  { periodo: '2026-03', usina: 'UFV Central',           skid: 'SKID F2', gen: 198120.0, irrad: 176.6, pr: 82.7 },
  { periodo: '2026-03', usina: 'UFV Central',           skid: 'SKID F3', gen: 199397.0, irrad: 176.6, pr: 82.7 },
  { periodo: '2026-03', usina: 'UFV Central',           skid: 'SKID F4', gen: 198622.0, irrad: 176.6, pr: 82.7 },
  { periodo: '2026-03', usina: 'UFV Central',           skid: 'SKID F5', gen: 197689.0, irrad: 176.6, pr: 82.7 },
  { periodo: '2026-03', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.1', gen: 133459.5, irrad: 146.3, pr: 63.3 },
  { periodo: '2026-03', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.2', gen: 53507.5,  irrad: 146.3, pr: 80.6 },
  { periodo: '2026-03', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.3', gen: 53507.5,  irrad: 146.3, pr: 41.3 },
  { periodo: '2026-03', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.4', gen: 65383.8,  irrad: 120.0, pr: 83.5 },
  { periodo: '2026-03', usina: 'UFV Partinga-BA',       skid: 'SKID1', gen: 209457.3, irrad: 182.5, pr: 75.5 },
  { periodo: '2026-03', usina: 'UFV Partinga-BA',       skid: 'SKID2', gen: 211503.2, irrad: 195.2, pr: 75.5 },
  { periodo: '2026-03', usina: 'UFV Partinga-BA',       skid: 'SKID3', gen: 212441.0, irrad: 195.2, pr: 75.5 },
  { periodo: '2026-03', usina: 'UFV Partinga-BA',       skid: 'SKID4', gen: 201902.9, irrad: 195.2, pr: 75.5 },
  { periodo: '2026-03', usina: 'UFV Partinga-BA',       skid: 'SKID5', gen: 215046.6, irrad: 195.2, pr: 75.5 },
  { periodo: '2026-03', usina: 'UFV Bom Futuro',        skid: null,    gen: 11923.1,  irrad: 146.3, pr: 86.9 },
  { periodo: '2026-03', usina: 'UFV Cerado Pedra I',    skid: null,    gen: 14185.4,  irrad: 146.3, pr: 103.3 },
  { periodo: '2026-03', usina: 'UFV Cercado Pedra II',  skid: null,    gen: 14295.5,  irrad: 146.3, pr: 104.1 },
  { periodo: '2026-03', usina: 'UFV Cercado Pedra III', skid: null,    gen: 13925.0,  irrad: 146.3, pr: 101.4 },
  { periodo: '2026-03', usina: 'UFV Nacional I',        skid: null,    gen: 14026.7,  irrad: 146.3, pr: 102.2 },
  { periodo: '2026-03', usina: 'UFV Nacional II',       skid: null,    gen: 5910.5,   irrad: 146.3, pr: 43.1 },
  { periodo: '2026-03', usina: 'UFV Efizi',             skid: null,    gen: 13058.0,  irrad: 146.3, pr: 95.0 },
  { periodo: '2026-03', usina: 'UFV Pedro Canario I',   skid: 'SKID1', gen: 183447.6, irrad: 195.6, pr: 57.8 },
  { periodo: '2026-03', usina: 'UFV Pedro Canario I',   skid: 'SKID2', gen: 175488.5, irrad: 195.6, pr: 57.8 },
  { periodo: '2026-03', usina: 'UFV Pedro Canario I',   skid: 'SKID3', gen: 92320.8,  irrad: 195.6, pr: 57.8 },
  { periodo: '2026-03', usina: 'UFV Pedro Canario II',  skid: 'SKID1', gen: 89234.5,  irrad: 195.6, pr: 76.0 },
  { periodo: '2026-03', usina: 'UFV Pedro Canario II',  skid: 'SKID2', gen: 161283.2, irrad: 195.6, pr: 76.0 },
  { periodo: '2026-03', usina: 'UFV Pedro Canario II',  skid: 'SKID3', gen: 163038.2, irrad: 195.6, pr: 76.0 },

  // -------- ABRIL / 2026 --------
  { periodo: '2026-04', usina: 'UFV Central',           skid: 'SKID F1', gen: 191869.0, irrad: 183.9, pr: 78.7 },
  { periodo: '2026-04', usina: 'UFV Central',           skid: 'SKID F2', gen: 194893.0, irrad: 183.9, pr: 78.7 },
  { periodo: '2026-04', usina: 'UFV Central',           skid: 'SKID F3', gen: 200654.0, irrad: 183.9, pr: 78.7 },
  { periodo: '2026-04', usina: 'UFV Central',           skid: 'SKID F4', gen: 199432.0, irrad: 183.9, pr: 78.7 },
  { periodo: '2026-04', usina: 'UFV Central',           skid: 'SKID F5', gen: 199751.0, irrad: 183.9, pr: 78.7 },
  { periodo: '2026-04', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.1', gen: 179368.5, irrad: 149.0, pr: 91.0 },
  { periodo: '2026-04', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.2', gen: 94436.0,  irrad: 149.0, pr: 91.0 },
  { periodo: '2026-04', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.3', gen: 94436.0,  irrad: 149.0, pr: 91.0 },
  { periodo: '2026-04', usina: 'UFV Sítio do Pescoço',  skid: 'USINA1.4', gen: 59507.9,  irrad: 104.6, pr: 86.0 },
  { periodo: '2026-04', usina: 'UFV Partinga-BA',       skid: 'SKID1', gen: 204657.9, irrad: 184.0, pr: 79.6 },
  { periodo: '2026-04', usina: 'UFV Partinga-BA',       skid: 'SKID2', gen: 211215.6, irrad: 184.0, pr: 79.6 },
  { periodo: '2026-04', usina: 'UFV Partinga-BA',       skid: 'SKID3', gen: 208634.5, irrad: 184.0, pr: 79.6 },
  { periodo: '2026-04', usina: 'UFV Partinga-BA',       skid: 'SKID4', gen: 206670.8, irrad: 184.0, pr: 79.6 },
  { periodo: '2026-04', usina: 'UFV Partinga-BA',       skid: 'SKID5', gen: 213558.5, irrad: 184.0, pr: 79.6 },
  { periodo: '2026-04', usina: 'UFV Bom Futuro',        skid: null,    gen: 11789.3,  irrad: 144.0, pr: 103.4 },
  { periodo: '2026-04', usina: 'UFV Cerado Pedra I',    skid: null,    gen: 13544.2,  irrad: 144.4, pr: 118.7 },
  { periodo: '2026-04', usina: 'UFV Cercado Pedra II',  skid: null,    gen: 13551.0,  irrad: 144.4, pr: 89.0 },
  { periodo: '2026-04', usina: 'UFV Cercado Pedra III', skid: null,    gen: 14176.0,  irrad: 144.4, pr: 90.5 },
  { periodo: '2026-04', usina: 'UFV Nacional I',        skid: null,    gen: 12368.0,  irrad: 144.4, pr: 89.2 },
  { periodo: '2026-04', usina: 'UFV Nacional II',       skid: null,    gen: 12541.0,  irrad: 144.4, pr: 90.5 },
  { periodo: '2026-04', usina: 'UFV Efizi',             skid: null,    gen: 11581.0,  irrad: 144.4, pr: 78.0 },
  { periodo: '2026-04', usina: 'UFV Pedro Canario I',   skid: 'SKID1', gen: 178175.9, irrad: 189.0, pr: 59.4 },
  { periodo: '2026-04', usina: 'UFV Pedro Canario I',   skid: 'SKID2', gen: 176163.2, irrad: 189.0, pr: 59.4 },
  { periodo: '2026-04', usina: 'UFV Pedro Canario I',   skid: 'SKID3', gen: 93765.4,  irrad: 189.0, pr: 59.4 },
  { periodo: '2026-04', usina: 'UFV Pedro Canario II',  skid: 'SKID1', gen: 89135.3,  irrad: 189.0, pr: 68.4 },
  { periodo: '2026-04', usina: 'UFV Pedro Canario II',  skid: 'SKID2', gen: 152314.3, irrad: 189.0, pr: 68.4 },
  { periodo: '2026-04', usina: 'UFV Pedro Canario II',  skid: 'SKID3', gen: 62427.2,  irrad: 189.0, pr: 68.4 },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    console.error('❌ Bloqueado em produção. Use SEED_FORCE=true se realmente desejar.');
    process.exit(1);
  }

  console.log('🌞 Importando lançamentos de geração Jan–Abr/2026…\n');

  // ---------- 1. Garante existência das novas usinas + SKIDs ----------
  console.log('📥 Garantindo usinas novas e SKIDs…');
  for (const u of NOVAS_USINAS) {
    let usina = await prisma.usina.findUnique({ where: { nome: u.nome } });
    if (!usina) {
      usina = await prisma.usina.create({
        data: {
          nome: u.nome,
          kwp: u.kwp,
          inicio: u.inicio,
          obs: 'Criada automaticamente pela importação de geração',
          moduloW: 400,
          inversorKw: 110,
        },
      });
      console.log(`   ✓ Criou usina: ${u.nome} (${u.kwp} kWp)`);
    } else {
      console.log(`   • Usina já existe: ${u.nome}`);
    }
    // Cria SKIDs faltantes
    const kwpPorSkid = u.kwp / u.skids.length;
    for (const skidNome of u.skids) {
      const existe = await prisma.skid.findFirst({
        where: { usinaId: usina.id, nome: skidNome },
      });
      if (!existe) {
        await prisma.skid.create({
          data: { usinaId: usina.id, nome: skidNome, kwp: kwpPorSkid },
        });
        console.log(`      + SKID ${skidNome} (${kwpPorSkid.toFixed(0)} kWp)`);
      }
    }
  }

  // ---------- 2. Inserir/atualizar lançamentos ----------
  console.log('\n⚡ Inserindo lançamentos…');
  // Cache de usinas e skids por nome
  const usinasCache = new Map();
  const skidsCache = new Map(); // key: `${usinaId}::${nome}`

  async function findUsina(nome) {
    if (usinasCache.has(nome)) return usinasCache.get(nome);
    const u = await prisma.usina.findUnique({ where: { nome } });
    usinasCache.set(nome, u);
    return u;
  }
  async function findSkid(usinaId, nome) {
    const k = `${usinaId}::${nome}`;
    if (skidsCache.has(k)) return skidsCache.get(k);
    const s = await prisma.skid.findFirst({ where: { usinaId, nome } });
    skidsCache.set(k, s);
    return s;
  }

  let added = 0;
  let updated = 0;
  const erros = [];

  for (const l of LANCAMENTOS) {
    const usina = await findUsina(l.usina);
    if (!usina) {
      erros.push({ ...l, erro: `usina "${l.usina}" não encontrada` });
      continue;
    }
    let skidId = null;
    if (l.skid) {
      const skid = await findSkid(usina.id, l.skid);
      if (!skid) {
        erros.push({ ...l, erro: `SKID "${l.skid}" não encontrado em ${l.usina}` });
        continue;
      }
      skidId = skid.id;
    }

    // upsert manual (Prisma não aceita null em unique composta no where)
    const existente = await prisma.lancamento.findFirst({
      where: { usinaId: usina.id, skidId, periodo: l.periodo },
      select: { id: true },
    });

    const payload = {
      geracao: l.gen,
      irrad: l.irrad,
      pr: l.pr,
      disp: 0,
      obs: 'Importado do arquivo de geração',
    };

    if (existente) {
      await prisma.lancamento.update({ where: { id: existente.id }, data: payload });
      updated++;
    } else {
      await prisma.lancamento.create({
        data: { usinaId: usina.id, skidId, periodo: l.periodo, ...payload },
      });
      added++;
    }
  }

  console.log(`\n📋 Resumo da importação:`);
  console.log(`   Total processado: ${LANCAMENTOS.length}`);
  console.log(`   ✓ Novos lançamentos: ${added}`);
  console.log(`   ↻ Atualizados: ${updated}`);
  if (erros.length) {
    console.log(`   ✗ Erros: ${erros.length}`);
    erros.slice(0, 5).forEach((e) =>
      console.log(`      ${e.periodo} ${e.usina}${e.skid ? '/' + e.skid : ''}: ${e.erro}`),
    );
  }

  // Estatísticas finais
  console.log(`\n📊 Estado final da base:`);
  console.log(`   Usinas:        ${await prisma.usina.count()}`);
  console.log(`   SKIDs:         ${await prisma.skid.count()}`);
  console.log(`   Lançamentos:   ${await prisma.lancamento.count()}`);
  console.log(`   Usuários:      ${await prisma.user.count()} (preservados)`);

  // Geração total por mês importado
  console.log(`\n⚡ Geração total importada por mês:`);
  for (const periodo of ['2026-01', '2026-02', '2026-03', '2026-04']) {
    const total = await prisma.lancamento.aggregate({
      where: { periodo },
      _sum: { geracao: true },
      _count: true,
    });
    console.log(`   ${periodo}: ${total._sum.geracao.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kWh em ${total._count} lançamentos`);
  }

  console.log('\n✅ Importação concluída.\n');
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
