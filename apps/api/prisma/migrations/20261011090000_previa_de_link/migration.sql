-- Prévia de links (Open Graph), compartilhada entre empresas.
CREATE TABLE "previas_de_link" (
    "url" TEXT NOT NULL,
    "titulo" TEXT,
    "descricao" TEXT,
    "imagem" TEXT,
    "site" TEXT,
    "buscadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "previas_de_link_pkey" PRIMARY KEY ("url")
);
