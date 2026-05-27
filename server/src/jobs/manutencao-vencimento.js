// =================================================
// JOB — alerta de manutenção vencida
// =================================================
// Roda a cada 5 minutos no servidor.
// Procura manutenções com:
//   - vencimento <= agora
//   - status != 'ok' (ainda não concluídas)
//   - vencimentoNotificado = false
// Notifica:
//   - O responsável (criadoPorId), se houver
//   - Todos os administradores ativos
// Marca como notificada para não duplicar.
// =================================================

import { prisma } from '../db.js';
import { notificarAdmins, notificarUsuario, fmtDataHora } from '../lib/notificar.js';

const INTERVALO_MS = 5 * 60 * 1000; // 5 minutos

async function verificar() {
  const agora = new Date();
  try {
    const vencidas = await prisma.manutencao.findMany({
      where: {
        vencimento: { lte: agora },
        status: { not: 'ok' },
        vencimentoNotificado: false,
      },
      include: {
        usina: { select: { nome: true } },
        criadoPor: { select: { id: true, nome: true } },
      },
    });

    if (!vencidas.length) return;

    console.log(`[vencimento-job] ${vencidas.length} manutenções vencidas encontradas`);

    for (const m of vencidas) {
      const dataVenc = new Date(m.vencimento).toLocaleDateString('pt-BR');
      const titulo = '⚠️ Manutenção vencida';
      const body = `"${m.titulo}" em ${m.usina.nome}${m.resp ? ' (resp: ' + m.resp + ')' : ''} venceu em ${dataVenc} e ainda não foi concluída.`;

      // Notifica admins
      await notificarAdmins({ titulo, body, tipo: 'er' });

      // Notifica o autor da OS (se ainda existir e for diferente de admin)
      if (m.criadoPor?.id) {
        await notificarUsuario(m.criadoPor.id, { titulo, body, tipo: 'er' });
      }

      // Marca como notificada para não duplicar
      await prisma.manutencao.update({
        where: { id: m.id },
        data: { vencimentoNotificado: true },
      });
    }
  } catch (e) {
    console.error('[vencimento-job] erro:', e.message);
  }
}

let timer = null;

export function iniciarJobVencimento() {
  // Roda 5 segundos após o boot, depois a cada 5 minutos
  setTimeout(verificar, 5000);
  timer = setInterval(verificar, INTERVALO_MS);
  console.log(`📅 Job de vencimento de manutenções iniciado (verifica a cada ${INTERVALO_MS / 60000} min)`);
}

export function pararJobVencimento() {
  if (timer) clearInterval(timer);
}

// Export pra poder rodar manualmente também
export { verificar as verificarVencimentos };
