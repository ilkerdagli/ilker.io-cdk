import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import { Stack, StackProps } from "aws-cdk-lib"
import * as path from "path"

import { Construct } from "constructs"

interface LambdaEdgeStackProps extends StackProps {}

export interface LambdaEdgeFunctions {
  defaultIndexLambda: cloudfront.experimental.EdgeFunction
}

export class LamdaEdgeStack extends Stack {
  readonly functions: LambdaEdgeFunctions
  constructor(scope: Construct, id: string, props: LambdaEdgeStackProps) {
    super(scope, id, props)
    this.functions = {
      defaultIndexLambda: new cloudfront.experimental.EdgeFunction(
        this,
        "DefaultIndexFunction",
        {
          runtime: lambda.Runtime.NODEJS_18_X,
          handler: "defaultIndex.handler",
          code: lambda.Code.fromAsset(path.join(__dirname, "lambdaFunctions")),
        }
      ),
    }
  }
}
