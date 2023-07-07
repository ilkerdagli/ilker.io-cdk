#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { IlkerIoStack } from "../lib/ilker.io-stack"
import { CertificateStack } from "../lib/certificate-stack"
import { LamdaEdgeStack } from "../lib/lambda-edge-stack"

const app = new cdk.App()

const domainName = "ilker.io"

const certificateStack = new CertificateStack(app, "IlkerIoCertificateStack", {
  domainNames: [domainName],
  env: { account: "103794843294", region: "us-east-1" },
})

const lamdaEdgeStack = new LamdaEdgeStack(app, "IlkerIoLamdaEdgeStack", {
  env: { account: "103794843294", region: "us-east-1" },
})

new IlkerIoStack(app, "IlkerIoStack", {
  env: { account: "103794843294", region: "eu-west-3" },
  domainName: domainName,
  certificates: certificateStack.certificates,
  lambdaEdgeFunctions: lamdaEdgeStack.functions,
  crossRegionReferences: true,
})
