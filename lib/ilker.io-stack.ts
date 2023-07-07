import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as codecommit from "aws-cdk-lib/aws-codecommit"
import * as codebuild from "aws-cdk-lib/aws-codebuild"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as acm from "aws-cdk-lib/aws-certificatemanager"
import * as origins from "aws-cdk-lib/aws-cloudfront-origins"
import * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions"
import * as route53targets from "aws-cdk-lib/aws-route53-targets"
import { LambdaEdgeFunctions } from "./lambda-edge-stack"

interface IlkerIoStackProps extends cdk.StackProps, cdk.StageProps {
  domainName: string
  certificates: Map<string, acm.Certificate>
  lambdaEdgeFunctions: LambdaEdgeFunctions
}

export class IlkerIoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IlkerIoStackProps) {
    super(scope, id, props)

    const domainName = props?.domainName

    const hugoVersion = process.env.HUGO_VERSION
      ? process.env.HUGO_VERSION
      : "0.114.1"

    const hugoSHA256 = process.env.HUGO_SHA256
      ? process.env.HUGO_SHA256
      : "018daab2560b4c78b47427f2075ac32b5eaf618a782a6be33693ce508150cd3c"

    const repo = new codecommit.Repository(
      this,
      `${domainName}-CodeCommitRepository`,
      {
        repositoryName: `${domainName}-hugo`,
        description: `${domainName} website`,
      }
    )

    const websiteBucket = new s3.Bucket(this, `${domainName}-WebSiteBucket`, {
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    const zone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: "Z0973406TYYYRHCPXG5I",
        zoneName: domainName,
      }
    )

    const accessIdentity = new cloudfront.OriginAccessIdentity(this, "OAI")
    websiteBucket.grantRead(accessIdentity)

    const origin = new origins.S3Origin(websiteBucket, {
      originAccessIdentity: accessIdentity,
    })

    const cloudfrontDistribution = new cloudfront.Distribution(
      this,
      `${domainName}-CFDist`,
      {
        certificate: props?.certificates.get(domainName),
        domainNames: [domainName],
        defaultRootObject: "index.html",
        defaultBehavior: {
          origin: origin,
          edgeLambdas: [
            {
              functionVersion:
                props.lambdaEdgeFunctions.defaultIndexLambda.currentVersion,
              eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            },
          ],
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      }
    )

    const sourceOutput = new codepipeline.Artifact()
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: "CodeCommit",
      repository: repo,
      branch: "main",
      output: sourceOutput,
    })

    // CodeBuild project to import submodules (themes) and generate static site content
    const project = new codebuild.PipelineProject(this, "CodeBuildProject", {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
              "curl -Ls https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_${HUGO_VERSION}_Linux-64bit.tar.gz -o /tmp/hugo.tar.gz",
              'echo "${HUGO_SHA256}  /tmp/hugo.tar.gz" | sha256sum -c -',
              "mkdir /tmp/hugo_${HUGO_VERSION}",
              "tar xf /tmp/hugo.tar.gz -C /tmp/hugo_${HUGO_VERSION}",
              "mv /tmp/hugo_${HUGO_VERSION}/hugo /usr/bin/hugo",
              "rm -rf /tmp/hugo*",
              'git config --global credential.helper "!aws codecommit credential-helper $@"',
              "git config --global credential.UseHttpPath true",
              "git init",
              `git remote add origin ${repo.repositoryCloneUrlHttp}`,
              "git fetch",
              "git checkout -f -t origin/main",
              "git submodule init",
              "git submodule update --recursive",
            ],
          },
          build: {
            commands: ["hugo"],
          },
        },
        artifacts: {
          files: ["**/*"],
          "base-directory": "public",
          name: "$(AWS_REGION)-$(date +%Y-%m-%d)",
        },
      }),
      environmentVariables: {
        HUGO_VERSION: { value: hugoVersion },
        HUGO_SHA256: { value: hugoSHA256 },
      },
    })

    repo.grantPull(project)

    const buildOutput = new codepipeline.Artifact()
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "CodeBuild",
      project: project,
      input: sourceOutput,
      outputs: [buildOutput],
    })

    const deployAction = new codepipeline_actions.S3DeployAction({
      actionName: "S3Deploy",
      bucket: websiteBucket,
      input: buildOutput,
    })

    const invalidateBuildProject = new codebuild.PipelineProject(
      this,
      `InvalidateProject`,
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                'aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_ID} --paths "/*"',
              ],
            },
          },
        }),
        environmentVariables: {
          CLOUDFRONT_ID: { value: cloudfrontDistribution.distributionId },
        },
      }
    )

    cloudfrontDistribution.grantCreateInvalidation(invalidateBuildProject)

    const invalidateBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "InvalidateBuild",
      project: invalidateBuildProject,
      input: buildOutput,
    })

    const pipeline = new codepipeline.Pipeline(this, "CodePipeline", {
      pipelineName: "HugoCodePipeline",
      stages: [
        {
          stageName: "CodeCommit",
          actions: [sourceAction],
        },
        {
          stageName: "Build",
          actions: [buildAction],
        },
        {
          stageName: "Deploy",
          actions: [deployAction],
        },
        {
          stageName: "CFInvalidate",
          actions: [invalidateBuildAction],
        },
      ],
    })

    new route53.ARecord(this, "ARecord", {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDistribution)
      ),
      zone,
    })
  }
}
