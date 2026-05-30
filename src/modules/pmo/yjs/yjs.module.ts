import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '@/modules/auth/auth.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { InternalYjsGuard } from './guards/internal-yjs.guard';
import { YjsController } from './yjs.controller';
import { YjsService } from './yjs.service';
import { YjsTokenService } from './yjs-token.service';

@Module({
  imports: [
    AuthModule,
    ProjectsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.internalSecret'),
        signOptions: { expiresIn: '2h' },
      }),
    }),
  ],
  controllers: [YjsController],
  providers: [YjsService, YjsTokenService, InternalYjsGuard],
  exports: [YjsTokenService],
})
export class YjsModule {}
