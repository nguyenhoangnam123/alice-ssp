variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "rate_limit_per_5min" {
  type        = number
  default     = 2000
  description = "Requests from a single IP within any rolling 5-minute window before WAF returns 429."
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
