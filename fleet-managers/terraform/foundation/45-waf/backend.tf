terraform {
  backend "s3" {
    bucket         = "ssp-platform-tfstate-195748744911"
    key            = "foundation/45-waf/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "ssp-platform-tflock"
    encrypt        = true
    profile        = "alice"
  }
}
