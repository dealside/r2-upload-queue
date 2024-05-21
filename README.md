# R2 upload queue test

Small reproducible demo of a Cloudflare Queue consumer exceeding CPU limits.

## Setup

Create R2 bucket:

```shell
npx wrangler r2 bucket create bot-media -J eu
```

Create Queue:

```shell
npx wrangler queues create upload-queue-test
```

Install and deploy

```shell
npm i

npm run deploy
```

## Run

In the Cloudflare dashboard, navigate to your newly created `upload-queue-test` queue. Send the following message to the queue:

```json
{
  "source": "https://ash-speed.hetzner.com/1GB.bin"
}
```

In your worker logs, you'll find the following message:

<img width="914" alt="image" src="https://github.com/dealside/r2-upload-queue/assets/10937632/dc2e54dc-9175-414a-af97-21fc45dff458">
