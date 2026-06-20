using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class RespondWrapper
    {
         public RespondWrapper()
        {
            Message = string.Empty;
        }
        public string Message { get; set; }
        public bool IsSuccess { get; set; }
        public Object? Result { get; set; }
    }
}

