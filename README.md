# Mapa de criminalidade em São Paulo

> [!IMPORTANT]  
> Embora o projeto tenha bugs e erros de performance, ele cumpriu com o objetivo que eu tinha em mente para ele.
> Retornarei a ele quando tiver mais tempo.

## Introdução

Este projeto tem como objetivo a visualização do [conjunto de dados de criminalidade](https://www.ssp.sp.gov.br/estatistica/consultas) disponibilizado pela Secretaria de Segurança Pública do Estado de São Paulo (SSP-SP) em um mapa interativo. A ideia é que o usuário possa visualizar a distribuição dos crimes em um mapa e filtrar os dados por tipo de crime e região.

O projeto é inspirado pelo [Crimap](https://crimap.azurewebsites.net), de autoria de [u/Ok_Basket_3573](https://reddit.com/u/Ok_Basket_3573/), e visa aprimorar os problemas de performance presentes na execução original.

## Tecnologias

O frontend é desenvolvido em Angular, com a biblioteca de mapas OpenLayers e com Material UI. O backend é desenvolvido em Rust, com o framework Actix Web. O banco de dados utilizado é o PostgreSQL, com a extensão PostGIS para consultas espaciais.
