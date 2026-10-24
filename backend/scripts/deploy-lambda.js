import { LambdaClient, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(backendDir, '.env') });

const region = process.env.AWS_REGION || 'ap-south-1';
const functionName = 'adaptive-exam-backend-api';

const lambdaClient = new LambdaClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  },
});

async function deploy() {
  console.log('===========================================================');
  console.log(`🚀 DEPLOYING BACKEND TO AWS LAMBDA: ${functionName}`);
  console.log(`Region: ${region}`);
  console.log('===========================================================');

  const zipPath = path.join(backendDir, 'lambda-deployment.zip');

  // 1. Create deployment zip
  console.log('📦 Step 1: Packaging Lambda deployment bundle...');
  try {
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    // Using tar (built-in on Windows 10/11 & Linux/macOS)
    execSync('tar -a -cf lambda-deployment.zip src node_modules lambda.js package.json', {
      cwd: backendDir,
      stdio: 'inherit',
    });
    console.log(`✅ Package created: lambda-deployment.zip (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (err) {
    console.error('❌ Failed to package zip:', err.message);
    process.exit(1);
  }

  // 2. Read zip buffer
  console.log('☁️ Step 2: Uploading code to AWS Lambda...');
  const zipBuffer = fs.readFileSync(zipPath);

  try {
    const updateCodeRes = await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ZipFile: zipBuffer,
      })
    );
    console.log(`✅ Function code updated successfully! (Status: ${updateCodeRes.LastUpdateStatus})`);
  } catch (err) {
    console.error('❌ Failed to update Lambda code:', err.message);
    process.exit(1);
  }

  // 3. Update Lambda Environment variables to ensure SNS Topic ARN is configured
  console.log('⚙️ Step 3: Synchronizing Lambda environment configuration...');
  try {
    const existing = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    const currentVars = existing.Configuration?.Environment?.Variables || {};

    const updatedVars = {
      ...currentVars,
      AWS_SNS_TOPIC_ARN: process.env.AWS_SNS_TOPIC_ARN || 'arn:aws:sns:ap-south-1:019711414548:adaptive-exam-proctoring-alerts',
      AWS_LAMBDA_EVALUATOR_ARN: process.env.AWS_LAMBDA_EVALUATOR_ARN || 'arn:aws:lambda:ap-south-1:019711414548:function:adaptive-exam-proctoring-processor',
    };

    await lambdaClient.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Environment: { Variables: updatedVars },
      })
    );
    console.log('✅ Lambda environment variables synchronized successfully!');
  } catch (err) {
    console.warn('⚠️ Environment variable update notice:', err.message);
  }

  console.log('===========================================================');
  console.log('🎉 DEPLOYMENT COMPLETE! The backend changes are now LIVE in AWS!');
  console.log('===========================================================');
}

deploy();
