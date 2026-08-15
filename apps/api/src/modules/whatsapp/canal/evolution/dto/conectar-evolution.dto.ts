import { IsString, IsUrl, MinLength } from 'class-validator';

export class ConectarEvolutionDto {
  /**
   * O endereço do servidor Evolution.
   *
   * Exige protocolo porque a Evolution precisa CHAMAR esta API de volta
   * pelo webhook: um endereço sem esquema conecta na hora e nunca entrega
   * mensagem nenhuma — a falha mais difícil de diagnosticar deste caminho,
   * porque a tela mostra "conectado" e o silêncio parece do cliente.
   */
  @IsUrl(
    { require_protocol: true, require_tld: false },
    { message: 'Informe o endereço completo do servidor, com https://.' },
  )
  baseUrl!: string;

  @IsString()
  @MinLength(8, { message: 'A chave da API parece curta demais.' })
  apiKey!: string;
}
