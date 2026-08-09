import {
  App,
  CfnOutput,
  LegacyStackSynthesizer,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
} from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
import { readFileSync } from 'node:fs'

const stackName = 'PureJsImageLambdaBenchmark'
const functionConfigurations = [
  {
    id: 'X86256',
    functionName: 'purejsimage-lambda-bench-256',
    architectureName: 'x86_64',
    architecture: lambda.Architecture.X86_64,
    memorySize: 256,
  },
  {
    id: 'X86512',
    functionName: 'purejsimage-lambda-bench-512',
    architectureName: 'x86_64',
    architecture: lambda.Architecture.X86_64,
    memorySize: 512,
  },
  {
    id: 'X861024',
    functionName: 'purejsimage-lambda-bench-1024',
    architectureName: 'x86_64',
    architecture: lambda.Architecture.X86_64,
    memorySize: 1024,
  },
  {
    id: 'Arm64512',
    functionName: 'purejsimage-lambda-bench-arm64-512',
    architectureName: 'arm64',
    architecture: lambda.Architecture.ARM_64,
    memorySize: 512,
  },
] as const
const parsedAssetLocation: unknown = JSON.parse(
  readFileSync(new URL('./.asset-location.json', import.meta.url), 'utf8'),
)
if (
  typeof parsedAssetLocation !== 'object' ||
  parsedAssetLocation === null ||
  !('bucket' in parsedAssetLocation) ||
  typeof parsedAssetLocation.bucket !== 'string' ||
  !('key' in parsedAssetLocation) ||
  typeof parsedAssetLocation.key !== 'string'
) {
  throw new Error('Run benchmark/aws-lambda/stage-assets.ts before synthesizing the stack')
}
const assetLocation = {
  bucket: parsedAssetLocation.bucket,
  key: parsedAssetLocation.key,
}
const legacySynthesizer = new LegacyStackSynthesizer()
const synthesizer = {
  bind: legacySynthesizer.bind.bind(legacySynthesizer),
  addFileAsset: legacySynthesizer.addFileAsset.bind(legacySynthesizer),
  addDockerImageAsset: legacySynthesizer.addDockerImageAsset.bind(legacySynthesizer),
  synthesize: legacySynthesizer.synthesize.bind(legacySynthesizer),
}

class LambdaBenchmarkStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    const role = new iam.Role(this, 'BenchmarkRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Temporary execution role for PureJsImage Lambda benchmarks',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    })
    const assetBucket = s3.Bucket.fromBucketName(this, 'BenchmarkAssetBucket', assetLocation.bucket)
    assetBucket.grantRead(role, 'fixtures/*')

    for (const configuration of functionConfigurations) {
      const logGroup = new logs.LogGroup(this, `BenchmarkLogGroup${configuration.id}`, {
        logGroupName: `/aws/lambda/${configuration.functionName}`,
        removalPolicy: RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.ONE_DAY,
      })
      const benchmarkFunction = new lambda.Function(this, `BenchmarkFunction${configuration.id}`, {
        functionName: configuration.functionName,
        description: `Temporary PureJsImage ${configuration.architectureName} benchmark at ${configuration.memorySize} MiB`,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: configuration.architecture,
        handler: 'index.handler',
        code: lambda.Code.fromBucket(assetBucket, assetLocation.key),
        memorySize: configuration.memorySize,
        timeout: Duration.minutes(2),
        ephemeralStorageSize: Size.mebibytes(512),
        role,
        logGroup,
        environment: {
          BENCHMARK_RUN_NONCE: 'deployed',
          BENCHMARK_FIXTURE_BUCKET: assetLocation.bucket,
        },
      })

      new CfnOutput(this, `FunctionName${configuration.id}`, {
        value: benchmarkFunction.functionName,
      })
    }
  }
}

const app = new App()
const account = process.env.CDK_DEFAULT_ACCOUNT
new LambdaBenchmarkStack(app, stackName, {
  stackName,
  synthesizer,
  env: {
    ...(account === undefined ? {} : { account }),
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  },
  description: 'Temporary AWS Lambda resources for PureJsImage cold-start and memory benchmarks',
})
