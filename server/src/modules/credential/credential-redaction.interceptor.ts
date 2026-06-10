import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { CredentialManagerService } from './credential-manager.service';

/**
 * 凭据响应/日志脱敏拦截器（需求 1.3、6.5）。
 *
 * 在接口响应序列化输出前，递归遍历响应体中的字符串值，检测是否包含与已存储凭据匹配的
 * 明文，命中则以脱敏占位符替代后再输出（需求 6.5）。日志侧复用 `redactLogPayload`，
 * 对将要写入日志/错误信息的负载做同样的递归脱敏（需求 6.5）。
 *
 * 注册为全局拦截器（见 CredentialModule 的 APP_INTERCEPTOR 提供者），覆盖所有控制器响应。
 */
@Injectable()
export class CredentialRedactionInterceptor implements NestInterceptor {
  constructor(
    @Inject(CredentialManagerService)
    private readonly credentialManager: CredentialManagerService,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.redactDeep(data)));
  }

  /**
   * 递归脱敏任意输出结构中的字符串（需求 6.5）。
   * 对对象/数组递归，对字符串调用 `redact`，其余原样返回。
   */
  redactDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (typeof value === 'string') {
      return this.credentialManager.redact(value);
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (seen.has(value as object)) {
      return value;
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => this.redactDeep(item, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      output[key] = this.redactDeep(val, seen);
    }
    return output;
  }

  /**
   * 日志脱敏入口（需求 6.5）：在任意日志/错误信息负载写出前做拦截脱敏。
   *
   * 与响应脱敏共享同一递归脱敏逻辑，使「检测到与已存储凭据匹配的明文将被输出到
   * 日志、错误信息或接口响应」时统一以脱敏占位符替代后再输出。
   */
  redactLogPayload(payload: unknown): unknown {
    return this.redactDeep(payload);
  }
}
