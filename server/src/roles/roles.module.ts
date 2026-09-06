import { Global, Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { PermissionsController } from '../permissions/permissions.controller';

/**
 * Global because the tenant provisioning flow calls `seedSystemRoles`, and the
 * bootstrap calls `syncPermissionCatalog` — neither of which belongs to the
 * roles feature module's own graph.
 */
@Global()
@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
