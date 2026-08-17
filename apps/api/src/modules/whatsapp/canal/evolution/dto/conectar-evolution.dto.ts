import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class ConectarEvolutionDto {
  /**
   * O endereço do servidor Evolution.
   *
   * Exige protocolo porque a Evolution precisa CHAMAR esta API de volta
   * pelo webhook: um endereço sem esquema conecta na hora e nunca entrega
   * mensagem nenhuma — a falha mais difícil de diagnosticar deste caminho,
   * porque a tela mostra "conectado" e o silêncio parece do cliente.
   */
  @IsOptional()
  @IsUrl(
    { require_protocol: true, require_tld: false },
    { message: 'Informe o endereço completo do servidor, com https://.' },
  )
  baseUrl?: string;

  /**
   * Opcionais na RECONEXÃO, e é o que faz o botão funcionar.
   *
   * A chave é guardada cifrada e a tela a apaga depois de salvar — quem
   * já conectou uma vez não a tem mais na mão pra colar. Exigi-la de novo
   * transformava "reconectar" num formulário impossível de enviar.
   */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A chave da API parece curta demais.' })
  apiKey?: string;
}
