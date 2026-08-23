/*
 * O service worker do Inteliwa.
 *
 * ELE NÃO GUARDA NADA EM CACHE, e isso é uma decisão, não um esquecimento.
 *
 * A receita comum de PWA é aproveitar o service worker pra cachear a
 * interface e funcionar offline. Aqui isso seria ruim de duas formas: o
 * painel é 100% dado ao vivo (conversas, socket, anexos), então offline
 * mostraria uma casca vazia; e o produto sobe várias vezes por dia, então
 * um cache agressivo entregaria a tela velha pra quem já recebeu a nova —
 * o defeito mais difícil de diagnosticar que existe, porque some quando o
 * suporte pede pra "limpar o cache".
 *
 * Ele existe por UM motivo: receber o aviso de mensagem nova quando o
 * painel está fechado. É a única coisa que a página sozinha não consegue
 * fazer.
 */

/*
 * Assume o controle sem esperar a próxima visita.
 *
 * O padrão do protocolo é o worker novo ficar "esperando" até todas as
 * abas antigas fecharem. Pra um cache isso é proteção; aqui é só atraso —
 * não há estado que possa quebrar, e a pessoa que acabou de autorizar as
 * notificações espera que elas funcionem agora, não amanhã.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) =>
  evento.waitUntil(self.clients.claim()),
);

/**
 * Chegou um aviso do servidor.
 *
 * O corpo vem do PushService, no formato { titulo, corpo, conversationId }.
 * O `try` existe porque alguns navegadores disparam um push VAZIO só pra
 * manter a inscrição viva — sem ele, esse ping viraria um erro no console
 * do worker a cada poucas horas.
 */
self.addEventListener("push", (evento) => {
  let aviso = {};
  try {
    aviso = evento.data ? evento.data.json() : {};
  } catch {
    aviso = {};
  }

  const titulo = aviso.titulo || "Nova mensagem";
  const corpo = aviso.corpo || "";
  const conversationId = aviso.conversationId || "";

  evento.waitUntil(
    (async () => {
      /*
       * Cala quando já há uma janela em primeiro plano.
       *
       * Sem esta conferência a pessoa receberia DOIS avisos pela mesma
       * mensagem: o do sistema, por aqui, e o da própria página, que
       * continua desenhando o dela. Quem está com o painel na frente já
       * viu a conversa subir na lista — o aviso do sistema aí é ruído.
       */
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (janelas.some((janela) => janela.focused)) return;

      await self.registration.showNotification(titulo, {
        body: corpo,
        icon: "/marca/icone-192.png",
        // O `badge` é o ícone monocromático da barra de status do Android.
        // Sem ele o sistema desenha um quadrado cinza genérico.
        badge: "/marca/icone-192.png",
        /*
         * Uma notificação POR CONVERSA, e não por mensagem.
         *
         * Cliente que manda cinco mensagens seguidas — o que é a regra no
         * WhatsApp, não a exceção — empilharia cinco avisos iguais na tela
         * de bloqueio. Com a tag, o quinto substitui o quarto.
         */
        tag: conversationId || "inteliwa",
        renotify: Boolean(conversationId),
        data: { conversationId },
      });
    })(),
  );
});

/**
 * Clicou no aviso: abre a conversa.
 *
 * Reaproveita uma janela já aberta em vez de abrir outra — quem tem o
 * painel atrás do navegador não quer uma segunda cópia dele. Só quando não
 * há nenhuma é que uma nova é criada.
 */
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();

  const conversationId = evento.notification.data?.conversationId;
  const destino = conversationId
    ? `/dashboard/inbox?c=${conversationId}`
    : "/dashboard/inbox";

  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const janela of janelas) {
        if ("focus" in janela) {
          // Navega ANTES de focar: focar primeiro mostraria por um instante
          // a conversa antiga antes de trocar.
          if ("navigate" in janela) await janela.navigate(destino);
          return janela.focus();
        }
      }

      return self.clients.openWindow(destino);
    })(),
  );
});
