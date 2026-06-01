variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type        = string
  default     = "alice"
  description = "Named profile in ~/.aws/credentials. Set to \"\" to fall back to AWS_PROFILE env var / instance role."
}

variable "state_bucket_name" {
  type        = string
  description = "S3 bucket for Terraform state. Must be globally unique."
}

variable "state_dynamodb_table" {
  type        = string
  description = "DynamoDB table for Terraform state locks."
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
