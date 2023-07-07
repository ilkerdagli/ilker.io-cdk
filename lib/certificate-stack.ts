import * as acm from "aws-cdk-lib/aws-certificatemanager"
import { Stack, StackProps } from "aws-cdk-lib"

import { Construct } from "constructs"

interface CertificateStackProps extends StackProps {
  domainNames: [string]
}

interface Certificate {
  domainName: string
  certificate: acm.Certificate
}

export class CertificateStack extends Stack {
  readonly certificates = new Map<string, acm.Certificate>()
  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props)
    props.domainNames.forEach((domainName) => {
      this.certificates.set(
        domainName,
        new acm.Certificate(this, `${domainName}-Cert`, {
          domainName: domainName,
          validation: acm.CertificateValidation.fromDns(),
        })
      )
    })
  }
}
