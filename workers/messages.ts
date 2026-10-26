export interface TileRequest {
  type: 'pws:tile-request';
  jobId: number;
  width: number;
  startY: number;
  endY: number;
  totalHeight: number;
  zoom: number;
}

export interface TileResponse {
  type: 'pws:tile-response';
  jobId: number;
  startY: number;
  errorChunk: Float32Array;
}

export interface WorkerError {
  type: 'pws:error';
  jobId: number;
  message: string;
  stack?: string;
}

export type WorkerInbound = TileRequest;
export type WorkerOutbound = TileResponse | WorkerError;
