/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

function appendToBuffer(buffer: Uint8Array, data: Uint8Array): Uint8Array {
	const newBuffer = new Uint8Array(buffer.length + data.length);
	newBuffer.set(buffer);
	newBuffer.set(data, buffer.length);
	return newBuffer;
}

export async function uploadLargeFileToR2(bucket: R2Bucket, source: string) {
	let mpu: R2MultipartUpload | null = null;
	try {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`Failed to fetch ${source}: ${response.statusText}`);
		}
		if (!response.body) {
			throw new Error('Fetch response contains no body');
		}

		const id = crypto.randomUUID();

		console.log(`initializing multipart upload: ${id}`);

		/* Initialize multipart upload */
		mpu = await bucket.createMultipartUpload(`test/${id}.mp4`, {
			httpMetadata: {
				contentType: 'video/mp4',
			},
		});

		/* Get a readable stream from out fetch request */
		const reader = response.body.getReader();

		/* Define chunk size (10 Megabyte) */
		const CHUNK_SIZE = 1024 * 1024 * 10;

		/* Buffer for the current ongoing part */
		let buffer: Uint8Array | null = null;

		/* Collects the part id objects for each uploaded part, this is sent upon completion */
		const partIds: R2UploadedPart[] = [];

		/* eslint-disable-next-line no-constant-condition */
		while (true) {
			const { done, value } = await reader.read();

			/* If stream is done upload potential last chunk and break out of while */
			if (done) {
				/* Upload any remaining data in the buffer as the last part */
				if (buffer && buffer.length > 0) {
					partIds.push(await mpu.uploadPart(partIds.length + 1, buffer));
				}
				break;
			}

			if (!buffer) {
				buffer = new Uint8Array(value);
			} else {
				/* Calculate the remaining space in the buffer */
				const remainingSpace: number = CHUNK_SIZE - buffer.length;

				/* If the current chunk would fit entirely in our buffer simply append it */
				if (value.length <= remainingSpace) {
					buffer = appendToBuffer(buffer, value);
				} else {
					/* Push chunk that would fit in buffer to existing buffer */
					buffer = appendToBuffer(buffer, value.subarray(0, remainingSpace));

					/* Flush full buffer into mpu */
					partIds.push(await mpu.uploadPart(partIds.length + 1, buffer));

					/* Initialize a new buffer with the remaining portion of the chunk that did not fit our current buffer */
					buffer = new Uint8Array(value.subarray(remainingSpace));
				}
			}
		}

		/* Upload all part ids and complete multipart to reassemble on storage side */
		await mpu.complete(partIds);

		console.log(`Upload finished ${id}`);
	} catch (err) {
		console.log(`uploadLargeFileToR2: ${err instanceof Error ? err.message : 'Unknown Error'}`);

		/* If we have an in-progress upload - abort it */
		if (mpu) await mpu.abort();
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== 'POST') return new Response('Invalid request', { status: 400 });

		const data = (await request.json()) as { source?: string };
		if (!data.source) return new Response('Invalid request', { status: 400 });

		await env.UPLOAD_QUEUE.send({ source: data.source });

		return new Response('Message put on queue');
	},

	async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
		for (let message of batch.messages) {
			/* Run queue entry */

			const { source } = message.body as { source: string };

			await uploadLargeFileToR2(env.MEDIA_BUCKET, source);
		}
	},
};
