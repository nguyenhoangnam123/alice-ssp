variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "state_bucket_name" {
  type = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
