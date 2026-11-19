/** 求解器统一错误：带稳定的 code，供 MCP 工具原样回给调用方。 */
export class SolverError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SolverError';
    this.code = code;
  }
}
