// =================================================
// LIMPA TODOS os lançamentos financeiros do banco.
// =================================================
// Uso:
//   1) Diagnóstico (mostra o que vai apagar):
//      node prisma/wipe-financeiro.js
//
//   2) Apagar de verdade (precisa confirmação explícita):
//      CONFIRM=DELETAR node prisma/wipe-financeiro.js
//
//   3) Em produção também precisa SEED_FORCE=true:
//      SEED_FORCE=true CONFIRM=DELETAR node prisma/wipe-financeiro.js
//
// IMPORTANTE: A operação é IRREVERSÍVEL — sem backup automático.
// Recomendo fazer backup antes:
//   sudo -u postgres pg_dump oasis_solar > backup-antes-wipe.sql
// =================================================

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('\n🧹 LIMPEZA DO FINANCEIRO\n');

  // Bloqueia em produção sem flag
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    console.error('❌ Bloqueado em produção.');
    console.error('   Use: SEED_FORCE=true CONFIRM=DELETAR node prisma/wipe-financeiro.js');
    process.exit(1);
  }

  // Mostra estado atual
  const total = await prisma.financeiro.count();
  if (total === 0) {
    console.log('   Nada para apagar — a tabela financeiro já está vazia.\n');
    return;
  }

  const porTipo = {
    rec: await prisma.financeiro.count({ where: { tipo: 'rec' } }),
    des: await prisma.financeiro.count({ where: { tipo: 'des' } }),
    fin: await prisma.financeiro.count({ where: { tipo: 'fin' } }),
  };
  const agg = await prisma.financeiro.aggregate({
    _sum: { val: true },
    _min: { data: true },
    _max: { data: true },
  });

  console.log('📊 Estado atual:');
  console.log(`   Total de lançamentos:      ${total}`);
  console.log(`   ↳ Receitas:                ${porTipo.rec}`);
  console.log(`   ↳ Despesas:                ${porTipo.des}`);
  console.log(`   ↳ Financiamentos:          ${porTipo.fin}`);
  console.log(`   Período coberto:           ${agg._min.data?.toISOString().slice(0, 10) || '?'} → ${agg._max.data?.toISOString().slice(0, 10) || '?'}`);
  console.log(`   Soma de valores:           R$ ${(agg._sum.val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  console.log('');

  if (process.env.CONFIRM !== 'DELETAR') {
    console.log('⚠️  Para APAGAR TUDO, rode novamente com:');
    console.log('   CONFIRM=DELETAR node prisma/wipe-financeiro.js');
    if (process.env.NODE_ENV === 'production') {
      console.log('   (e em produção: SEED_FORCE=true também)');
    }
    console.log('');
    return;
  }

  console.log('🗑️  Apagando todos os lançamentos financeiros...');
  const del = await prisma.financeiro.deleteMany();
  console.log(`   ✓ ${del.count} lançamentos removidos.`);

  // Audit log
  await prisma.auditLog.create({
    data: {
      acao: 'wipe',
      recurso: 'Financeiro',
      payload: JSON.stringify({
        removidos: del.count,
        executadoPor: 'CLI wipe-financeiro.js',
        timestamp: new Date().toISOString(),
      }),
    },
  });
  console.log('   ✓ Audit log gravado.');

  console.log('\n✅ LIMPEZA CONCLUÍDA\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
