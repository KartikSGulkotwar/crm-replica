import { WorkspaceRole } from '@crm-replica/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation';

export class UpdateWorkspaceDto {
  @ApiProperty({ example: 'Acme Inc.' })
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'Workspace name must be 1 to 100 characters' })
  name: string;
}

export class UpdateMemberDto {
  @ApiProperty({ enum: WorkspaceRole })
  @IsEnum(WorkspaceRole, { message: 'Role must be admin or member' })
  role: WorkspaceRole;
}
