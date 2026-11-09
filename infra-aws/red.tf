# Red del clúster. Equivale a infra/modules/red.
# Solo subredes PÚBLICAS: los jugadores se conectan directo a la IP del nodo
# (Agones) y así no hace falta un NAT Gateway, que costaría ~USD 33 al mes.
data "aws_availability_zones" "zonas" {
  state = "available"
}

resource "aws_vpc" "nebula" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "nebula-vpc" }
}

resource "aws_internet_gateway" "nebula" {
  vpc_id = aws_vpc.nebula.id
  tags   = { Name = "nebula-igw" }
}

# EKS exige al menos dos zonas de disponibilidad.
resource "aws_subnet" "publica" {
  count                   = 2
  vpc_id                  = aws_vpc.nebula.id
  cidr_block              = cidrsubnet(aws_vpc.nebula.cidr_block, 4, count.index)
  availability_zone       = data.aws_availability_zones.zonas.names[count.index]
  map_public_ip_on_launch = true
  tags = {
    Name                     = "nebula-publica-${count.index}"
    "kubernetes.io/role/elb" = "1" # aquí se crean los balanceadores (matchmaker)
  }
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.nebula.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.nebula.id
  }
  tags = { Name = "nebula-publica" }
}

resource "aws_route_table_association" "publica" {
  count          = 2
  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

# Agones asigna a cada partida un puerto entre 7000 y 8000 en el nodo.
# (WebSocket viaja sobre TCP; se abre también UDP como en la versión de GCP.)
resource "aws_vpc_security_group_ingress_rule" "juego" {
  for_each          = toset(["tcp", "udp"])
  security_group_id = aws_eks_cluster.nebula.vpc_config[0].cluster_security_group_id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = each.value
  from_port         = 7000
  to_port           = 8000
  description       = "puertos de partida de Agones (${each.value})"
}
