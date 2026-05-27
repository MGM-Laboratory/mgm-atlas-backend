import { IsNumber, IsUUID } from 'class-validator';

export class MoveTaskDto {
  @IsUUID('4')
  statusId!: string;

  /// Fractional index produced client-side by averaging the neighbours.
  /// Sent as a number; backend stores as Decimal(20,10) in Postgres.
  @IsNumber()
  positionInStatus!: number;
}
